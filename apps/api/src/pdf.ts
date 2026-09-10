const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const LINE_HEIGHT = 15;

function pdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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

/** Creates a small, dependency-free PDF for operational text documents. */
export function textPdf(title: string, sourceLines: string[]) {
  const lines = sourceLines.flatMap((line) => wrap(line));
  const linesPerPage = Math.floor(
    (PAGE_HEIGHT - MARGIN * 2 - 24) / LINE_HEIGHT,
  );
  const pages: string[][] = [];
  for (
    let offset = 0;
    offset < lines.length || offset === 0;
    offset += linesPerPage
  )
    pages.push(lines.slice(offset, offset + linesPerPage));

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const [pageIndex, pageLines] of pages.entries()) {
    const commands = [
      "BT",
      "/F1 16 Tf",
      `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`,
      `(${pdfText(title)}) Tj`,
      `0 -24 Td`,
      "/F1 9 Tf",
      ...pageLines.flatMap((line, index) => [
        ...(index ? [`0 -${LINE_HEIGHT} Td`] : []),
        `(${pdfText(line)}) Tj`,
      ]),
      "ET",
    ].join("\n");
    const streamId = add(
      `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    );
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    pageIds.push(pageId);
    if (pageIndex < pages.length - 1) continue;
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

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
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
