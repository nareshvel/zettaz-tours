import { deflateSync, inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Paper profiles.
 *
 * Physical sizes and margins mirror the Zettaz Cloud print module
 * (PAPER_SIZE_PHYSICAL) so both products put ink in the same place, and so the
 * shared Go print agent receives a PDF whose page box already matches the
 * mediaSize it is told to print at. That match matters: CUPS prints at actual
 * size anchored to the queue's default media box, so a mismatched page is
 * silently clipped rather than scaled. The agent passes `fit-to-page` as a
 * safety net, but a correctly-sized page means it never has to do anything.
 *
 * Unlike Cloud — whose page layouts are bound to a 210x297 template designer —
 * this renderer computes every position, so real Letter geometry costs nothing
 * and we do not need the scale-to-fit approximation.
 *
 * Thermal rolls have no fixed height: `height: null` means the page grows to
 * fit its content, which is what a continuous roll expects.
 */
const MM = 72 / 25.4;

export type MediaSize = "a4" | "letter" | "58mm" | "80mm";

export type PaperProfile = {
  width: number;
  /** null = continuous roll; page height is derived from content. */
  height: number | null;
  marginX: number;
  marginY: number;
  titleSize: number;
  bodySize: number;
  lineHeight: number;
};

export const PAPER: Record<MediaSize, PaperProfile> = {
  a4: {
    width: 210 * MM,
    height: 297 * MM,
    marginX: 16 * MM,
    marginY: 18 * MM,
    titleSize: 16,
    bodySize: 9,
    lineHeight: 15,
  },
  letter: {
    width: 8.5 * 72,
    height: 11 * 72,
    marginX: 16 * MM,
    marginY: 18 * MM,
    titleSize: 16,
    bodySize: 9,
    lineHeight: 15,
  },
  "58mm": {
    width: 58 * MM,
    height: null,
    marginX: 3 * MM,
    marginY: 2 * MM,
    titleSize: 9,
    bodySize: 7,
    lineHeight: 9.5,
  },
  "80mm": {
    width: 80 * MM,
    height: null,
    marginX: 4 * MM,
    marginY: 3 * MM,
    titleSize: 10,
    bodySize: 8,
    lineHeight: 11,
  },
};

export function paperProfile(media: MediaSize = "a4") {
  return PAPER[media] ?? PAPER.a4;
}

export function isContinuous(media: MediaSize) {
  return paperProfile(media).height === null;
}

// Retained for the existing A4 receipt layout, which positions off these.
const PAGE_WIDTH = PAPER.a4.width;
const PAGE_HEIGHT = PAPER.a4.height as number;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 15;

/** PDF numbers: fixed precision keeps output deterministic and compact. */
function round(value: number) {
  return Number(value.toFixed(2));
}

function pdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\u00a0|\u202f|\u2007|\u2009/g, " ")
    .replace(/[·•]/g, "|")
    .replace(/[×✕✖]/g, "x")
    .replace(/[—–−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Wraps to a measured width rather than a character count.
 *
 * Counting characters only ever worked because A4 leaves ~35% slack: the same
 * 88-character line of wide glyphs overflows a 58mm roll by a quarter. Helvetica
 * is proportional, so the only correct measure is the advance width at the font
 * size actually used. Words longer than the line are hard-broken so a single
 * long token can never run off the page.
 */
function wrapToWidth(value: string, maxWidth: number, fontSize: number) {
  const fits = (s: string) => helveticaWidth(s, fontSize) <= maxWidth;
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  const pushWord = (word: string) => {
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of words) {
    if (!line) {
      if (fits(word)) line = word;
      else pushWord(word);
      continue;
    }
    if (fits(`${line} ${word}`)) line += ` ${word}`;
    else {
      lines.push(line);
      line = "";
      if (fits(word)) line = word;
      else pushWord(word);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function wrap(value: string, width = 88) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

function assemblePdf(objects: string[]) {
  let body = "%PDF-1.4\n%Zettaz\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

/** Creates a small, dependency-free PDF for operational text documents. */
export function textPdf(
  title: string,
  sourceLines: string[],
  media: MediaSize = "a4",
) {
  const paper = paperProfile(media);
  const titleGap = paper.titleSize + 8;
  const contentWidth = paper.width - paper.marginX * 2;
  const lines = sourceLines.flatMap((line) =>
    wrapToWidth(line, contentWidth, paper.bodySize),
  );

  // A continuous roll is one page as tall as its content; a sheet paginates.
  const continuous = paper.height === null;
  const pages: string[][] = continuous
    ? [lines]
    : (() => {
        const perPage = Math.max(
          1,
          Math.floor(
            ((paper.height as number) - paper.marginY * 2 - titleGap) /
              paper.lineHeight,
          ),
        );
        const out: string[][] = [];
        for (
          let offset = 0;
          offset < lines.length || offset === 0;
          offset += perPage
        )
          out.push(lines.slice(offset, offset + perPage));
        return out;
      })();

  const pageHeight = (pageLines: string[]) =>
    continuous
      ? Math.max(
          paper.marginY * 2 + titleGap + pageLines.length * paper.lineHeight,
          40,
        )
      : (paper.height as number);

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    const height = pageHeight(pageLines);
    const commands = [
      "BT",
      `/F1 ${paper.titleSize} Tf`,
      `${round(paper.marginX)} ${round(height - paper.marginY)} Td`,
      `(${pdfText(title)}) Tj`,
      `0 -${round(titleGap)} Td`,
      `/F1 ${paper.bodySize} Tf`,
      ...pageLines.flatMap((line, index) => [
        ...(index ? [`0 -${round(paper.lineHeight)} Td`] : []),
        `(${pdfText(line)}) Tj`,
      ]),
      "ET",
    ].join("\n");
    const streamId = add(
      `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${round(paper.width)} ${round(height)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,
      ),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  return assemblePdf(objects);
}

type PdfImage = {
  width: number;
  height: number;
  colorSpace: "DeviceRGB" | "DeviceGray";
  bitsPerComponent: number;
  filter: "DCTDecode" | "FlateDecode";
  data: Buffer;
};

function pngChunk(
  buffer: Buffer,
  type: string,
): { data: Buffer; next: number } | null {
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const next = offset + 12 + length;
    if (chunkType === type) return { data, next };
    if (chunkType === "IEND") return null;
    offset = next;
  }
  return null;
}

function decodePng(buffer: Buffer): PdfImage | null {
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    return null;
  const ihdr = pngChunk(buffer, "IHDR");
  if (!ihdr || ihdr.data.length < 13) return null;
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8] ?? 0;
  const colorType = ihdr.data[9] ?? -1;
  if (
    bitDepth !== 8 ||
    width < 1 ||
    height < 1 ||
    width > 2000 ||
    height > 2000
  )
    return null;
  if (![0, 2, 6].includes(colorType)) return null;
  const idatParts: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (chunkType === "IDAT") idatParts.push(data);
    if (chunkType === "IEND") break;
  }
  if (!idatParts.length) return null;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idatParts));
  } catch {
    return null;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const stride = 1 + width * channels;
  if (inflated.length < stride * height) return null;
  const rgb = Buffer.alloc(width * height * (colorType === 0 ? 1 : 3));
  const prior = Buffer.alloc(width * channels);
  const sample = (buf: Buffer, index: number) => buf[index] ?? 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filter = sample(inflated, rowStart);
    const row = inflated.subarray(rowStart + 1, rowStart + stride);
    const recon = Buffer.alloc(width * channels);
    for (let i = 0; i < row.length; i++) {
      const left = i >= channels ? sample(recon, i - channels) : 0;
      const up = sample(prior, i);
      const upLeft = i >= channels ? sample(prior, i - channels) : 0;
      let value = sample(row, i);
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3)
        value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (value + pr) & 0xff;
      } else if (filter !== 0) return null;
      recon[i] = value;
    }
    for (let x = 0; x < width; x++) {
      if (colorType === 0) {
        rgb[y * width + x] = sample(recon, x);
      } else if (colorType === 2) {
        const src = x * 3;
        const dst = (y * width + x) * 3;
        rgb[dst] = sample(recon, src);
        rgb[dst + 1] = sample(recon, src + 1);
        rgb[dst + 2] = sample(recon, src + 2);
      } else {
        const src = x * 4;
        const dst = (y * width + x) * 3;
        const alpha = sample(recon, src + 3) / 255;
        rgb[dst] = Math.round(255 * (1 - alpha) + sample(recon, src) * alpha);
        rgb[dst + 1] = Math.round(
          255 * (1 - alpha) + sample(recon, src + 1) * alpha,
        );
        rgb[dst + 2] = Math.round(
          255 * (1 - alpha) + sample(recon, src + 2) * alpha,
        );
      }
    }
    recon.copy(prior);
  }
  return {
    width,
    height,
    colorSpace: colorType === 0 ? "DeviceGray" : "DeviceRGB",
    bitsPerComponent: 8,
    filter: "FlateDecode",
    data: deflateSync(rgb),
  };
}

function decodeJpeg(buffer: Buffer): PdfImage | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) break;
    const size = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 9 < buffer.length) {
      height = buffer.readUInt16BE(offset + 5);
      width = buffer.readUInt16BE(offset + 7);
      break;
    }
    offset += 2 + size;
  }
  if (!width || !height) return null;
  return {
    width,
    height,
    colorSpace: "DeviceRGB",
    bitsPerComponent: 8,
    filter: "DCTDecode",
    data: buffer,
  };
}

export async function loadTenantLogo(
  logoPath: string | null | undefined,
): Promise<PdfImage | null> {
  if (!logoPath) return null;
  try {
    const absolute = path.resolve("." + logoPath);
    const bytes = await readFile(absolute);
    const ext = path.extname(absolute).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return decodeJpeg(bytes);
    if (ext === ".png") return decodePng(bytes);
    return null;
  } catch {
    return null;
  }
}

export type ReceiptPdfInput = {
  tenantName: string;
  contactLines: string[];
  logo?: PdfImage | null;
  documentTitle?: string;
  reservationRef: string;
  status: string;
  issuedAt: string;
  productName: string;
  departureAt: string;
  leadName: string;
  leadEmail: string;
  leadPhone?: string;
  source: string;
  party: string;
  travellers: string[];
  partnerLine?: string;
  chargeLines: { label: string; amount: string }[];
  totals: { label: string; amount: string; emphasize?: boolean }[];
  payments: {
    when: string;
    amount: string;
    method: string;
    status: string;
    detail: string;
  }[];
  footerNote: string;
};

type DrawCmd = string;

function drawText(
  commands: DrawCmd[],
  font: "F1" | "F2",
  size: number,
  x: number,
  y: number,
  text: string,
) {
  commands.push(
    "BT",
    `/${font} ${size} Tf`,
    `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
    `(${pdfText(text)}) Tj`,
    "ET",
  );
}

/** Approximate Helvetica advance width for right-aligned money columns. */
function helveticaWidth(text: string, size: number) {
  const readable = pdfText(text)
    .replace(/\\\\/g, "\\")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")");
  let units = 0;
  for (const char of readable) {
    if ("ilI.,:;!'| ".includes(char)) units += 0.28;
    else if ("mwMW@%".includes(char)) units += 0.83;
    else if (char >= "0" && char <= "9") units += 0.5;
    else if ("$€£¥#".includes(char)) units += 0.55;
    else units += 0.56;
  }
  return units * size;
}

function drawTextRight(
  commands: DrawCmd[],
  font: "F1" | "F2",
  size: number,
  rightEdge: number,
  y: number,
  text: string,
) {
  drawText(
    commands,
    font,
    size,
    rightEdge - helveticaWidth(text, size),
    y,
    text,
  );
}

function drawLine(
  commands: DrawCmd[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 0.6,
) {
  commands.push(
    `${width} w`,
    `${x1.toFixed(2)} ${y1.toFixed(2)} m`,
    `${x2.toFixed(2)} ${y2.toFixed(2)} l`,
    "S",
  );
}

/**
 * Shared page assembly for both receipt layouts.
 *
 * When a logo is embedded the file has to be built as a Buffer rather than a
 * string: the image stream is raw binary and would be corrupted by any
 * text-encoding pass, so offsets are tracked by hand for the xref table.
 */
function assembleReceiptPage(
  commands: DrawCmd[],
  pageWidth: number,
  pageHeight: number,
  logo: PdfImage | null,
) {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const regularFont = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const boldFont = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );
  let imageId: number | null = null;
  let imageResource = "";
  if (logo) {
    imageId = add(
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /${logo.colorSpace} /BitsPerComponent ${logo.bitsPerComponent} /Filter /${logo.filter} /Length ${logo.data.length} >>\nstream\n`,
    );
    // Binary stream must be appended carefully; rebuild object with buffer length in final assembly below.
  }
  const content = commands.join("\n");
  const streamId = add(
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  );
  if (imageId && logo) {
    objects[imageId - 1] =
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /${logo.colorSpace} /BitsPerComponent ${logo.bitsPerComponent} /Filter /${logo.filter} /Length ${logo.data.length} >>\nstream\n` +
      // Placeholder replaced after we know we need binary-safe assembly
      `__IMAGE__\nendstream`;
    imageResource = `/XObject << /Im1 ${imageId} 0 R >>`;
  }
  const pageId = add(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${round(pageWidth)} ${round(pageHeight)}] /Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> ${imageResource} >> /Contents ${streamId} 0 R >>`,
  );
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`;

  if (!logo || !imageId) return assemblePdf(objects);

  // Binary-safe assembly for embedded image streams.
  let body = Buffer.from("%PDF-1.4\n%Zettaz\n", "ascii");
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(body.length);
    const object = objects[index];
    if (index === imageId - 1) {
      const header = Buffer.from(
        `${index + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /${logo.colorSpace} /BitsPerComponent ${logo.bitsPerComponent} /Filter /${logo.filter} /Length ${logo.data.length} >>\nstream\n`,
        "ascii",
      );
      const footer = Buffer.from("\nendstream\nendobj\n", "ascii");
      body = Buffer.concat([body, header, logo.data, footer]);
      continue;
    }
    body = Buffer.concat([
      body,
      Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "ascii"),
    ]);
  }
  const xref = body.length;
  let xrefBlock = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  xrefBlock += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  xrefBlock += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(xrefBlock, "ascii")]);
}

/**
 * Receipt for a 58mm or 80mm roll.
 *
 * A roll is not a narrow sheet: the two-column label/value layout used on A4
 * has nowhere to go at 147pt of usable width, so everything stacks in a single
 * column with money right-aligned to the edge. Height is measured, not fixed —
 * the page is built once the content is laid out, which is what a continuous
 * roll expects and what stops the printer feeding blank paper.
 *
 * Laid out top-down into a local list, then flipped into PDF coordinates at the
 * end, because the final height is not known until the last line is placed.
 */
function thermalReceiptPdf(input: ReceiptPdfInput, media: MediaSize) {
  const paper = paperProfile(media);
  const width = paper.width;
  const left = paper.marginX;
  const right = width - paper.marginX;
  const contentWidth = right - left;
  const base = paper.bodySize;
  const small = base - 1;

  type Item =
    | { kind: "text"; font: "F1" | "F2"; size: number; text: string }
    | {
        kind: "split";
        size: number;
        bold?: boolean;
        left: string;
        right: string;
      }
    | { kind: "rule" }
    | { kind: "gap"; height: number };

  const items: Item[] = [];
  const text = (t: string, font: "F1" | "F2" = "F1", size = base) => {
    for (const line of wrapToWidth(t, contentWidth, size))
      items.push({ kind: "text", font, size, text: line });
  };
  const split = (l: string, r: string, bold = false, size = base) =>
    items.push({ kind: "split", size, bold, left: l, right: r });
  const rule = () => items.push({ kind: "rule" });
  const gap = (height = base * 0.6) => items.push({ kind: "gap", height });

  // Header — centred-ish identity block.
  text(input.tenantName, "F2", base + 1);
  for (const line of input.contactLines) text(line, "F1", small);
  gap();
  rule();
  text(input.documentTitle ?? "Reservation receipt", "F2", base);
  text(`Ref ${input.reservationRef}`, "F1", small);
  text(input.issuedAt, "F1", small);
  rule();

  // Trip.
  text(input.productName, "F2", base);
  text(input.departureAt, "F1", small);
  text(`Party: ${input.party}`, "F1", small);
  if (input.travellers.length) {
    gap(base * 0.3);
    for (const traveller of input.travellers) text(traveller, "F1", small);
  }
  gap(base * 0.3);
  text(input.leadName, "F1", small);
  if (input.leadEmail) text(input.leadEmail, "F1", small);
  if (input.leadPhone) text(input.leadPhone, "F1", small);
  if (input.partnerLine) text(input.partnerLine, "F1", small);
  rule();

  // Money.
  for (const line of input.chargeLines)
    split(line.label, line.amount, false, small);
  if (input.totals.length) gap(base * 0.3);
  for (const total of input.totals)
    split(
      total.label,
      total.amount,
      total.emphasize,
      total.emphasize ? base : small,
    );

  if (input.payments.length) {
    rule();
    text("Payments", "F2", small);
    for (const payment of input.payments) {
      split(payment.method, payment.amount, false, small);
      const detail = [payment.when, payment.status, payment.detail]
        .filter(Boolean)
        .join(" · ");
      if (detail) text(detail, "F1", small - 0.5);
    }
  }

  if (input.footerNote) {
    rule();
    text(input.footerNote, "F1", small - 0.5);
  }
  // Rolls are cut a little past the last line; trailing feed avoids clipping.
  gap(base * 2);

  // Measure, then place.
  const lineGap = 1.6;
  const height =
    paper.marginY * 2 +
    items.reduce((total, item) => {
      if (item.kind === "gap") return total + item.height;
      if (item.kind === "rule") return total + base * 0.9;
      return total + item.size + lineGap;
    }, 0);

  const commands: DrawCmd[] = [];
  let y = height - paper.marginY;
  for (const item of items) {
    if (item.kind === "gap") {
      y -= item.height;
      continue;
    }
    if (item.kind === "rule") {
      y -= base * 0.45;
      drawLine(commands, left, y, right, y, 0.4);
      y -= base * 0.45;
      continue;
    }
    y -= item.size;
    if (item.kind === "text") {
      drawText(commands, item.font, item.size, left, y, item.text);
    } else {
      const font = item.bold ? "F2" : "F1";
      drawText(commands, font, item.size, left, y, item.left);
      drawTextRight(commands, font, item.size, right, y, item.right);
    }
    y -= lineGap;
  }

  // The logo is skipped on a roll: thermal heads are monochrome and low DPI, so
  // a scaled colour mark prints as a smear. The name carries the branding.
  return assembleReceiptPage(commands, width, height, null);
}

/** Branded reservation receipt with optional tenant logo. */
export function receiptPdf(input: ReceiptPdfInput, media: MediaSize = "a4") {
  if (media === "58mm" || media === "80mm")
    return thermalReceiptPdf(input, media);

  // Shadow the A4 module constants with the chosen sheet's geometry, so the
  // layout below positions against the real page without any other change.
  const sheet = paperProfile(media);
  const PAGE_WIDTH = sheet.width;
  const PAGE_HEIGHT = sheet.height as number;
  const MARGIN = 48;

  const title = input.documentTitle ?? "Reservation receipt";
  const commands: DrawCmd[] = [];
  let y = PAGE_HEIGHT - MARGIN;
  const labelX = MARGIN;
  const valueX = MARGIN + 118;
  const rightX = PAGE_WIDTH - MARGIN;

  const logo = input.logo ?? null;
  let logoDraw: { x: number; y: number; w: number; h: number } | null = null;
  if (logo) {
    const maxW = 110;
    const maxH = 42;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    logoDraw = { x: MARGIN, y: y - h, w, h };
    commands.push(
      "q",
      `${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${logoDraw.x.toFixed(2)} ${logoDraw.y.toFixed(2)} cm`,
      "/Im1 Do",
      "Q",
    );
  }

  const headerLeft = logoDraw ? MARGIN + logoDraw.w + 14 : MARGIN;
  drawText(commands, "F2", 16, headerLeft, y - 14, input.tenantName);
  let contactY = y - 30;
  for (const line of input.contactLines.slice(0, 4)) {
    drawText(commands, "F1", 8, headerLeft, contactY, line);
    contactY -= 11;
  }
  drawText(commands, "F2", 12, rightX - 120, y - 12, title);
  drawText(commands, "F1", 8, rightX - 120, y - 26, `Issued ${input.issuedAt}`);

  y = Math.min(contactY, logoDraw ? logoDraw.y : y - 36) - 16;
  drawLine(commands, MARGIN, y, rightX, y, 1);
  y -= 22;

  const meta: [string, string][] = [
    ["Reference", input.reservationRef],
    ["Status", input.status],
    ["Experience", input.productName],
    ["Departure", input.departureAt],
  ];
  for (const [label, value] of meta) {
    for (const [index, line] of wrap(value, 70).entries()) {
      if (index === 0) drawText(commands, "F1", 9, labelX, y, label);
      drawText(commands, index === 0 ? "F2" : "F1", 9, valueX, y, line);
      y -= 14;
    }
  }

  y -= 6;
  drawLine(commands, MARGIN, y, rightX, y);
  y -= 18;
  drawText(commands, "F2", 11, labelX, y, "Guest details");
  y -= 16;

  const guest: [string, string][] = [
    ["Lead guest", input.leadName],
    ["Email", input.leadEmail],
    ...(input.leadPhone
      ? [["Phone", input.leadPhone] as [string, string]]
      : []),
    ["Source", input.source],
    ["Party", input.party || "-"],
  ];
  for (const [label, value] of guest) {
    drawText(commands, "F1", 9, labelX, y, label);
    drawText(commands, "F1", 9, valueX, y, value);
    y -= 13;
  }
  if (input.partnerLine) {
    drawText(commands, "F1", 9, labelX, y, "Partner");
    for (const [index, line] of wrap(input.partnerLine, 70).entries()) {
      drawText(commands, "F1", 9, valueX, y, line);
      y -= 13;
      if (index === 0) continue;
    }
  }
  y -= 2;
  drawText(commands, "F1", 9, labelX, y, "Travellers");
  if (!input.travellers.length) {
    drawText(commands, "F1", 9, valueX, y, "Roster not recorded");
    y -= 13;
  } else {
    for (const [index, traveller] of input.travellers.entries()) {
      drawText(commands, "F1", 9, valueX, y, traveller);
      y -= 13;
      if (index === 0) continue;
    }
  }

  y -= 6;
  drawLine(commands, MARGIN, y, rightX, y);
  y -= 18;
  drawText(commands, "F2", 11, labelX, y, "Charges");
  y -= 16;
  for (const line of input.chargeLines) {
    drawText(commands, "F1", 9, labelX, y, line.label);
    drawTextRight(commands, "F1", 9, rightX, y, line.amount);
    y -= 13;
  }
  y -= 4;
  for (const total of input.totals) {
    drawText(
      commands,
      total.emphasize ? "F2" : "F1",
      total.emphasize ? 10 : 9,
      labelX,
      y,
      total.label,
    );
    drawTextRight(
      commands,
      total.emphasize ? "F2" : "F1",
      total.emphasize ? 10 : 9,
      rightX,
      y,
      total.amount,
    );
    y -= total.emphasize ? 15 : 13;
  }

  y -= 6;
  drawLine(commands, MARGIN, y, rightX, y);
  y -= 18;
  drawText(commands, "F2", 11, labelX, y, "Payments");
  y -= 16;
  if (!input.payments.length) {
    drawText(commands, "F1", 9, labelX, y, "No payments recorded");
    y -= 13;
  } else {
    for (const payment of input.payments) {
      if (y < MARGIN + 80) break;
      drawText(commands, "F1", 9, labelX, y, payment.when);
      drawText(commands, "F2", 9, MARGIN + 150, y, payment.amount);
      drawText(
        commands,
        "F1",
        9,
        MARGIN + 240,
        y,
        `${payment.method} | ${payment.status}`,
      );
      y -= 12;
      if (payment.detail) {
        for (const line of wrap(payment.detail, 92)) {
          drawText(commands, "F1", 8, labelX, y, line);
          y -= 11;
        }
      }
      y -= 4;
    }
  }

  y = Math.max(MARGIN + 36, Math.min(y - 18, MARGIN + 70));
  drawLine(commands, MARGIN, y + 14, rightX, y + 14);
  for (const line of wrap(input.footerNote, 96)) {
    drawText(commands, "F1", 7.5, labelX, y, line);
    y -= 10;
  }

  return assembleReceiptPage(commands, PAGE_WIDTH, PAGE_HEIGHT, logo);
}
