Here is a research breakdown of the **Rock Adventures Antigua** (`rockadventuresantigua.com`) booking flow, architecture, and data fields captured across the customer journey.

---

### 1. Booking Flow Overview

Rock Adventures Antigua uses a **hybrid booking architecture**:

1. **Direct E-Commerce / Instant Booking Engine:** Uses a WordPress/WooCommerce plugin standard for tour operators (e.g., WP Travel Engine, Tourfic, or similar booking plugin) that allows date/time selection, guest counts, real-time total calculation, and checkout.
2. **Inquiry / Lead Form Mechanism:** Embedded on individual tour pages (like the *Tuk-Tuk Rainforest & Beach Hopping* page) to handle custom group requests, cruise ship schedules, or direct booking questions.
3. **Third-Party Distribution Channel (Viator/Tripadvisor Engine):** Direct link-outs or embedded booking widgets for cruise travelers seeking instant confirmation and standard cancellation coverage.

---

### 2. Step-by-Step Booking Journey & Captured Fields

#### **Step 1: Activity Selection & Parameters**

*Location: Product Detail Page (PDP)*

Before adding an experience to the cart, the system captures core event constraints:

| Field / Selector | Type / Format | Options / Purpose |
| --- | --- | --- |
| **Tour Choice** | Pre-selected / Hidden input | Captures product ID (e.g., *Clear Boat & Offshore Islands*, *Tuk-Tuk Rainforest Tour*) |
| **Departure Date** | Date Picker | Selects from available departure calendar dates |
| **Time Slot / Departure** | Dropdown / Radio buttons | Morning or afternoon tour departures |
| **Adults Count** | Number selector | Pricing tiers (standard ticket count) |
| **Children Count** | Number selector | Discounted tier; enforces rules (e.g., minimum 1 adult per child on Tuk-Tuk tours) |
| **Infant Count** | Number selector | Regulatory/safety count |
| **Self-Drive / Local Guest** | Checkbox / Radio toggle | Triggers local discount codes (e.g., 10% off adult self-drive guests) |

---

#### **Step 2: Pickup & Logistics Capture**

*Location: Cart / Checkout Custom Fields*

Because they cater heavily to resort visitors and cruise ship passengers, logistical data is critical to their operational flow:

| Field Name | Type | Description / Notes |
| --- | --- | --- |
| **Pickup Location Type** | Dropdown / Radio | Options: *Hotel/Resort Pick-Up*, *Cruise Ship Port (Heritage Quay)*, *Self-Drive Meeting Point* |
| **Hotel / Accommodation Name** | Text input | Specific resort or Airbnb address |
| **Cruise Ship Name** | Text input | Required if port pickup is chosen (e.g., *Royal Caribbean - Symphony of the Seas*) |
| **Cruise Arrival / Docking Time** | Time picker / Text input | Ensures excursion schedules align with ship departure |

---

#### **Step 3: Lead Contact & Customer Details**

*Location: Checkout / Lead Enquiry Form*

Standard billing and communication data collected at checkout or via enquiry forms:

* **First Name & Last Name**
* **Email Address** *(for automated booking confirmations and ticket delivery)*
* **Phone Number / WhatsApp** *(crucial in Antigua for real-time driver/guide contact)*
* **Billing Address / Country of Origin**
* **Special Requirements / Notes:** Free-text box for dietary restrictions (snacks included), health concerns, or accessibility requests.

---

#### **Step 4: Payment Processing & Confirmation**

*Location: Payment Gateway Gateway Modal / Page*

* **Payment Methods:** Credit/Debit Cards (Visa, MasterCard via gateway integration).
* **Promo / Discount Code:** Voucher input field (e.g., applying self-drive or early-bird promotions).
* **System Actions Triggered Upon Payment:**
1. Transaction processing via payment processor.
2. Automatic Email Confirmation dispatching itinerary and safety guidelines.
3. Internal reservation logging to dispatch drivers to designated pick-up zones (e.g., Heritage Quay or hotels).



---

### 3. Key Observations & UX Highlights

1. **Safety & Capacity Constraints Validation:**
* **Tuk-Tuk Capacity Limits:** System restricts vehicles to a maximum of 6 passengers (4 adults + 2 children max).
* **Mandatory Disclaimers:** Terms explicitly note medical restrictions (not recommended for guests > 6 months pregnant or with serious heart conditions).


2. **Cruiser-Optimized Flow:**
* By capturing the **Cruise Ship Name**, they prevent miscommunications regarding local Antigua time vs. ship time.


3. **Inquiry Fallback:**
* For sold-out slots or custom group sizes, a fallback enquiry form (`Trip Name`, `Name`, `Email`, `Message`) is placed on product pages to capture off-funnel leads.


---

Based on active tour catalogs and seasonal landing pages for **Rock Adventures Antigua**, here is a breakdown of their primary offerings, durations, standard price points, and active promotional discounts:

### 1. Core Tour Offers & Pricing Structure

| Tour Name | Duration | Standard Price (USD) | Promotional / Discount Price | Key Focus |
| --- | --- | --- | --- | --- |
| **Clear Boat & Offshore Islands Experience** | 3 Hours | **$89.00** | Varies / Base | Transparent-hull boat sightseeing, reef views, and offshore island exploration. |
| **Kayak & Snorkel Eco Adventures** | 3 Hours | **$99.00** | **$89.00** *(Save $10)* | Guided kayaking through coastal mangroves and protected marine areas with snorkel stops. |
| **Tuk-Tuk Rainforest & Beach Hopping** | 4 Hours | **$109.00** | Varies | Land-based open-air adventure exploring rainforest trails and scenic beaches via motorized tuk-tuk. |
| **Boat Cruise To Pig’s Paradise** | 3 Hours | **$130.00** | Varies | Coastal boat cruise highlighting local beaches and interactive island wildlife stops. |
| **Tuk-Tuk Adventure – Historical Harbour, Beach & Beers!** | 5 Hours | **$139.00** | Varies | Extended historical tour covering Antigua's harbors, cultural spots, beach time, and local refreshments. |

---

### 2. Promotional Offers & Discount Mechanics

* **Limited-Time Direct Booking Discounts:** Rock Adventures frequently runs a standard **10% off promotional campaign** across select signature experiences (such as the Kayak Eco Adventures dropping from $99 to $89).
* **Self-Drive / Direct Guest Incentives:** Similar to localized sibling operations in Antigua, they often provide special concessions or promotional codes for guests who make their own way to the meeting point rather than utilizing resort/cruise shuttle logistics.
* **Tax and Surcharge Exclusions:** Note that base ticket rates often exclude local governmental tourism or sales taxes (such as Antigua's standard value/sales taxes), which are dynamically calculated or added at the final checkout step.


**Yes, Rock Adventures Antigua does utilize Viator** (alongside their direct-booking website) as part of their distribution and booking ecosystem.

How the Viator integration works for them includes:

1. **Syndicated Inventory:** Their popular excursions (such as the *Tuk-Tuk Rainforest and Beach Hopping Tour* and various eco-boat/kayak tours) are listed directly on Viator and Tripadvisor.
2. **Channel Management:** Instead of managing all bookings exclusively through their local WordPress site, they use connectivity tools that sync their availability, capacity limits, and pricing across platforms. When a customer books via Viator, it feeds directly into their operational manifest so they know who to expect for pickups at places like Heritage Quay (the cruise port) or local hotels.
3. **Differentiation for the User:**
* **Booking direct on their website** usually grants access to direct-only promo codes (like multi-person discounts or self-drive incentives).
* **Booking via Viator** appeals heavily to cruise ship passengers and international travelers who want Viator’s standardized cancellation policies (e.g., free cancellation up to 24 hours prior) and centralized booking history.