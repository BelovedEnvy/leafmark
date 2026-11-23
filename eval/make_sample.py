"""Regenerate public/sample.pdf with Python and ReportLab 4.4.9.

Original, fictional handbook and associated golden data: CC0-1.0.
"""
from math import sin
from pathlib import Path
from textwrap import dedent

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
PAPER = (510, 720)
INK, GREEN, MUTED, RULE, WASH = map(HexColor, ["#25302c", "#345a45", "#58695e", "#b9c9bd", "#e9efe9"])

# Each entry corresponds to a physical page after the cover. Tables are
# selectable text in aligned columns, giving the parser real geometry to read.
CHAPTERS = [
    ("Opening the station",
     """Use the north footbridge for routine access. The south gate opens onto the meadow and belongs to the grazing tenant. A delivery label with the meadow address does not change the route. Leave the bridge latch as you found it and take wet outerwear off before opening a sample envelope.

     The opening sheet lives inside the green cabinet. Enter the visit date, the observer's initials and the condition of the door seal on a single line. A second visitor can add their initials to that same entry. If the previous entry has no closing signature, leave it intact and open a fresh line.

     Look at the wall clock before handling a logger. This first look records how the station was found. A clock adjustment or a fresh battery belongs on the service sheet later in the visit. Keep those two observations separate even when one person completes both sheets.""",
     "Arrival sequence", ["Place", "Record", "Sheet"],
     [["Bridge", "Access condition", "Opening"], ["Dry porch", "Door seal", "Opening"], ["Bench", "Clock reading", "Service"]]),
    ("Reading the staff gauge",
     """Read the water line against the east face of the staff gauge. The west face has a ladder of installation marks that is visible from the bridge. Those marks belong to the survey crew and do not form another scale. Record the water level to the nearest centimetre.

     Allow a short wake from floating debris to pass before taking a reading. Where ripples persist, write the high and low observations in the margin and take the midpoint for the ledger. The margin preserves what the observer saw and makes the midpoint traceable later.

     A pale band below the current level may be a stain from the last flood. Use the liquid surface at the gauge for today's entry. If the foot of the plate has moved, keep the raw figure, mark the reading provisional and attach a sketch to the service sheet.""",
     "Example field entries", ["Time", "Observed level", "Condition"],
     [["08:10", "41 cm", "Still"], ["08:15", "40 to 42 cm", "Ripples"], ["08:20", "41 cm", "Still"]]),
    ("Automatic logging",
     """Program the water-level logger for a 15-minute interval. Align readings to the quarter hour in UTC. The display at the hut can show local civil time, so copy the logger's zone setting onto the service sheet before interpreting its first record.

     Read the stored serial number from the downloaded file and compare it with the number etched on the housing. Cable tags can move between cabinets. A matching tag alone does not establish which instrument recorded a series. Preserve the original filename when making the first copy.

     A visit between scheduled readings will leave the last timestamp looking slightly old. Wait for the next scheduled record before marking a run incomplete. Write the actual inspection time beside that record. A manual spot reading belongs in the hand ledger and should never be inserted into the automatic series.""",
     "Quarter-hour alignment", ["Minute", "Logger event", "Zone"],
     [["00", "Sample", "UTC"], ["15", "Sample", "UTC"], ["30", "Sample", "UTC"], ["45", "Sample", "UTC"]]),
    ("Rain collector",
     """Clear the collector funnel with the soft blue brush. A dry leaf can span the throat while leaving the rim clear. Check the opening from above before removing the inner cup. Record what was obstructing it so a reviewer can interpret a quiet interval after rain.

     The reference pour is 100 millilitres of clean water. Add it slowly from the marked bottle and write down the number of tips shown by the counter. This is a functional check after cleaning. It gives the observer a repeatable way to spot a sticking bucket without altering a calibration setting.

     When the test finishes, flag the start and end time of the pour in the event ledger. Those tips have the same electronic signature as rain. A future reader needs the time window to identify them. Return the bottle to the dry shelf and leave the collector in its normal position.""",
     "Service kit", ["Item", "Marking", "Stored at"],
     [["Brush", "Blue handle", "Rain drawer"], ["Pour bottle", "100 mL line", "Dry shelf"], ["Event ledger", "Brown cover", "Desk"]]),
    ("Temperature reference",
     """Place the reference thermometer beside the working probe for ten minutes before comparing them. Keep the two sensing ends at the same depth in the shaded comparison vessel. A probe left in sunlight can give a plausible reading that belongs to a different temperature history.

     Record both displayed temperatures and the signed difference. A difference greater than 0.4 degrees Celsius triggers a repeat comparison. Start a new line for the repeat, keeping the first pair intact. An unexplained correction to the first line would hide a useful clue about equilibration.

     Write the reference instrument's serial number beside the pair. If the working probe is exchanged on the same visit, enter a second pair under its replacement serial number. That record gives the office a clean boundary between two instruments whose displayed values may be almost identical.""",
     "Comparison record", ["Field", "First reading", "Repeat"],
     [["Reference", "12.2 C", "12.2 C"], ["Working probe", "12.7 C", "12.4 C"], ["Signed difference", "+0.5 C", "+0.2 C"]]),
    ("Power checks",
     """Measure battery voltage before connecting the bench charger. Take the reading at the marked test points with the station load still attached. Enter the value on the power card. A value copied after charging cannot explain a missing sequence from the morning.

     Flag a loaded reading below 11.8 volts for a battery exchange. The spare is identified by its bench tag and date, both of which belong in the service record. A spare without a completed bench tag stays on the shelf until its identity can be established.

     After the exchange, check that the logger has kept its clock and interval settings. A lit display only shows that the screen has power. Wait for the next scheduled record, read its timestamp and put that time beside the new battery's tag in the ledger.""",
     "Power card fields", ["Position", "Value to copy", "When"],
     [["Incoming", "Loaded voltage", "Before charge"], ["Replacement", "Bench tag", "At exchange"], ["Logger", "First timestamp", "After exchange"]]),
    ("Clock comparisons",
     """Record the clock offset in seconds before changing the logger. Use a positive sign when the logger runs ahead of the reference. Use a negative sign when it runs behind. The reference is the receiver on the desk once it displays a current UTC fix.

     An offset larger than 30 seconds in either direction requires a clock correction. Record both the old timestamp and the new timestamp. A list of corrected times by itself cannot reveal whether an apparent gap in a series came from the instrument or from the adjustment.

     Keep the comparison and the correction on adjoining ledger lines. If the receiver has no current fix, record the failed comparison and leave the logger clock alone. An approximate time from memory is less useful than a documented, measurable offset obtained on the next visit.""",
     "Offset convention", ["Logger versus reference", "Entry", "Action"],
     [["12 seconds ahead", "+12 s", "Record"], ["18 seconds behind", "-18 s", "Record"], ["42 seconds ahead", "+42 s", "Correct"]]),
    ("Bottle identification",
     """Label every sample bottle before it leaves the bench. The identifier joins the station code, the visit date and a two-digit sequence with hyphens. Use the compact date order shown in the example. Start the sequence again at 01 for each new visit date.

     Write the identifier on both the cap strip and the bottle body. If a strip becomes detached, the permanent body label still ties the sample to the visit. A label written only on a bag can follow the wrong bottle when two visitors unpack their kits together.

     Enter the same identifier in the chain sheet before the bottle goes into the carrier. If a bottle breaks before dispatch, retain its line and mark it broken. Continue with the next sequence number. Reusing an identifier makes the chain sheet look complete while concealing a lost sample.""",
     "Worked identifiers", ["Station", "Visit order", "Bottle identifier"],
     [["ABK", "First", "ABK-20250408-01"], ["ABK", "Second", "ABK-20250408-02"], ["ABK", "Third", "ABK-20250408-03"]]),
    ("Dispatch and custody",
     """Seal the sample carrier with a numbered paper seal. Copy that number onto the chain sheet while the carrier is still on the bench. When a dispatch contains two carriers, prepare a separate chain sheet for each. The sheets follow the carriers as independent units.

     The receiving clerk signs the lower copy at handover. Keep the signed lower copy in the station binder. The upper copy travels with the carrier so the receiving desk can attach its observations to the same set of bottle identifiers.

     If a seal is damaged before collection, record its number and the reason for replacement beside the new number. Do not erase the superseded number. Its presence explains why a seal listed in the stock book has no corresponding arrival at the receiving desk.""",
     "Custody copies", ["Copy", "Destination", "Evidence"],
     [["Upper", "Carrier", "Bottle list"], ["Lower", "Station binder", "Clerk signature"], ["Seal stub", "Stock book", "Seal number"]]),
    ("Duplicate samples",
     """Collect a duplicate on every fifth routine bottle. Assign the duplicate its own identifier and link it to the routine bottle in the duplicate register. Do not put the link on the carrier label. The receiving desk needs to process both bottles through the ordinary sequence.

     Count routine bottles across the visit in the order they are filled. A blank bottle and a duplicate bottle do not advance that count. If the fifth routine bottle is spoiled before dispatch, preserve the event in the ledger and explain the missing partner in the register.

     After the results return, compare each linked pair using the identifiers in the register. Similar numbers are no evidence of a pairing by themselves. A pair that cannot be linked back to the register stays unresolved until the collector can account for the discrepancy.""",
     "Counting example", ["Bottle filled", "Routine count", "Duplicate due"],
     [["Routine", "4", "No"], ["Field blank", "4", "No"], ["Routine", "5", "Yes"], ["Duplicate", "5", "No"]]),
    ("Photographing the reach",
     """Align the camera with the brass notch on the west parapet. The first frame should include both banks and the upstream staff gauge. That fixed view allows later readers to compare channel conditions even when vegetation on the near bank has grown across the path.

     A second frame may show a floating branch, a damaged plate or another detail that the first view cannot resolve. Record its direction in ordinary words in the image ledger. The fixed view and the detail view answer different questions and should keep distinct filenames.

     Preserve the original image before cropping a copy for a report. Enter a filename exactly as it appears on the camera card. A renamed image can still be useful in a report, provided that the ledger identifies its uncropped original and the visit on which it was made.""",
     "View record", ["Frame", "Orientation", "Required content"],
     [["First", "From brass notch", "Both banks and gauge"], ["Detail", "As recorded", "Observed feature"], ["Report copy", "May be cropped", "Original filename link"]]),
    ("Daily data copies",
     """Make two independent copies before clearing a recorder card. One copy goes to the field laptop and the other to the removable archive drive. Two folders on the same laptop share the same physical failure risk and count as a single destination.

     Verify each copy against the original using SHA-256. Write the digest into the transfer manifest with the filename and byte count. Matching filenames and modification times can occur when a transfer ends early, so the digest is the acceptance check for this operation.

     If the archive drive is unavailable, retain the card and leave its sleeve in the pending tray. Complete the second verified copy on the next visit. The pending tray exists to keep an incomplete transfer visible without changing a recorder card that still holds the original observations.""",
     "Transfer destinations", ["Medium", "Contents", "Check"],
     [["Field laptop", "First copy", "SHA-256"], ["Archive drive", "Second copy", "SHA-256"], ["Recorder card", "Original", "Retain until verified"]]),
    ("Handling missing records",
     """Mark missing logger readings with the literal code GAP. Keep the surrounding timestamps exactly as recorded. An empty cell can disappear when a table is imported, while a zero is an ordinary measured value. The explicit code lets the next reader distinguish an absence from a measurement.

     Use a separate event row to describe an observed cause. For example, a card exchange may explain a short interruption, but it does not supply a water level for the missing quarter hour. Keep the cause and the observation in their respective records.

     Leave an unexplained gap open until a contemporaneous note or an instrument record can support an explanation. A tidy series can be less informative than an incomplete one. When a cause is confirmed, add the evidence reference and the review date beside the existing event entry.""",
     "Series excerpt", ["UTC", "Level", "Event reference"],
     [["07:45", "38 cm", "None"], ["08:00", "GAP", "Card exchange"], ["08:15", "39 cm", "None"]]),
    ("Dry-cabinet stock",
     """Count consumables at the end of the final visit each month. Use the labels on the drawer fronts to locate stock. A loose item found on the wrong shelf goes into the return tray until its marking can be checked against the order book.

     Reorder paper seals when fewer than twelve remain. The count includes intact, numbered seals in the dry cabinet. Stubs already entered in the stock book are evidence of earlier use and are excluded. Enter the actual count that triggered the order.

     Put an order reference beside the count as soon as the request is sent. If another observer visits before delivery, that reference explains the low stock and prevents a duplicate request. Record the incoming batch on a new line so its numbering can be traced independently.""",
     "End-of-month count", ["Drawer", "Counted unit", "Example count"],
     [["Seals", "Intact numbered seal", "11"], ["Brushes", "Marked brush", "3"], ["Sleeves", "Empty card sleeve", "8"]]),
    ("Archive schedule",
     """The office archive schedule retains service cards for five years. The period begins when a card is closed, which can occur several months after its first entry. Write the closure date in the upper right corner before transferring the completed card to the archive box.

     Transfer the cards in closure-date order and retain the correspondence between the box number and the station binder. Where a card continues on a second sheet, place the sheets together and carry the closure date onto the continuation sheet.

     This copy of the schedule carries no issue date. The station binder also includes a keeper's insert addressing the same cards. Neither copy bears a cancellation mark. A reviewer reconciling the two should preserve both statements until the records owner issues a signed decision.""",
     "Archive transfer slip", ["Field", "Source", "Destination"],
     [["Closure date", "Service card", "Transfer slip"], ["Box number", "Box spine", "Station binder"], ["Continuation", "Second sheet", "Same box"]]),
    ("Keeper's insert",
     """The keeper's insert retains service cards for three years after closure. It addresses the same completed service cards that move from the station binder to the office archive. It does not define a separate working copy or a different start date for the period.

     For a transfer, list the box number and the initials of the person who sealed the lid. The initials belong to the actual packing visit. A person who later moves the box adds a separate movement entry instead of overwriting the original packing record.

     The insert was found behind the binder index with no issue date or approval signature. The office schedule remains filed alongside it. The order in which the pages are bound provides no evidence about which retention instruction was approved last.""",
     "Keeper's transfer fields", ["At packing", "At movement", "At receipt"],
     [["Box number", "Box number", "Box number"], ["Packer initials", "Mover initials", "Receiver initials"], ["Closure range", "Movement date", "Receipt date"]]),
    ("Walkover checklist",
     """The desk checklist calls for a bank walkover every Monday. Starting at the north footbridge, follow the marked reach to the downstream willow and return by the same path. The ordinary weekly walkover covers the whole reach, including the sheltered bend beside the gauge.

     Describe changes relative to the most recent fixed photograph. A newly exposed root and a root that has merely become visible through thinner grass belong in different entries. Include a small sketch when the fixed frame cannot show the feature clearly.

     The desk checklist and the cabinet card both describe this ordinary weekly walkover. The binder contains no signed amendment choosing between their named days. Do not infer a decision from the order of the entries on an individual observer's visit sheet.""",
     "Walkover sequence", ["Stop", "Observation", "Record"],
     [["Footbridge", "Starting condition", "Visit sheet"], ["Sheltered bend", "Bank changes", "Sketch if needed"], ["Downstream willow", "End condition", "Visit sheet"]]),
    ("Cabinet walkover card",
     """The cabinet card calls for a bank walkover every Thursday. It describes the same reach from the north footbridge to the downstream willow as the desk checklist. The card makes no reference to a second route or a different crew.

     Return the card to its clear sleeve after each inspection. Use a separate visit sheet for findings. Keeping observations off the card allows the same printed instructions to remain legible while the visit record grows over the season.

     Both the card and the desk checklist were present when this handbook was assembled. Neither has a revision date. A record of a visit on a particular weekday tells the reader when one observer went out, but it does not resolve the conflicting weekly instructions.""",
     "Card and sheet", ["Object", "Usual location", "Purpose"],
     [["Printed card", "Clear sleeve", "Route instruction"], ["Visit sheet", "Desk binder", "Findings"], ["Field sketch", "With visit sheet", "Location detail"]]),
    ("Closing and handover",
     """Leave the cabinet key in the numbered return pouch. Write the pouch number beside the closing signature. The next opening observer can then identify the pouch used at the end of the previous visit, even when two observers exchange duties between visits.

     Read the pending tray before closing the binder. A recorder card awaiting its second copy, a stock item awaiting identification and a service sheet awaiting a signature require different follow-up. Name the next action plainly and identify the object it concerns.

     End the visit with a last look at the rain funnel and the bridge latch. Record the departure time on the opening sheet. When two people leave separately, the last person to secure the hut signs the closing line. Preserve the earlier arrival entry as it was written.""",
     "Handover record", ["Object", "Closing entry", "Next check"],
     [["Cabinet key", "Pouch number", "Next opening"], ["Pending tray", "Named action", "Next visit"], ["Opening sheet", "Departure time", "Closing signature"]]),
]

# Reference observations from the fictional reach. The appendix introduces
# nearby measurements and service vocabulary as realistic retrieval distractors.
# Date, starting level (cm), change over the extract (cm), water temperature
# (C), and the observer's note.
VISITS = [
    ("8 April", 41, -1, 8.1, "A willow branch was caught below the bridge at opening. The gauge face remained clear throughout the visit."),
    ("22 April", 38, 3, 9.4, "The collector rim was damp. The tips during the reference pour were marked in the event ledger before departure."),
    ("6 May", 43, -3, 10.8, "A pale flood stain crossed the west side of the staff plate. The east face had a clear liquid surface for both hand readings."),
    ("20 May", 37, 1, 11.6, "A second frame from the footbridge shows new leaves crossing the fixed view. The original photograph was retained on the card."),
    ("3 June", 39, -2, 12.9, "The field laptop completed its copy. The observer paired the archive copy with the same digest in the transfer manifest."),
    ("17 June", 35, -1, 14.1, "A collector brush was returned from the bench to the rain drawer. The funnel throat was clear after inspection."),
    ("1 July", 34, 0, 15.4, "The near bank had little surface movement. The margin of the ledger includes a sketch of the staff plate at the water line."),
    ("15 July", 33, 4, 16.2, "The first quarter-hour record was already on the card at opening. Manual observations were kept on the hand sheet."),
    ("29 July", 40, -2, 16.5, "A wake passed the bridge during the first visit to the gauge. The hand reading was taken after the surface settled."),
    ("12 August", 36, -1, 16.0, "The opening observer found an incomplete transfer in the pending tray. Its recorder card stayed in its marked sleeve."),
    ("26 August", 35, 2, 15.1, "A second bottle carrier was prepared at the bench. Each carrier had a chain sheet and its own numbered paper seal."),
    ("9 September", 42, 2, 13.6, "The temperature reference vessel remained in shade. The signed instrument difference was copied to the service sheet."),
    ("23 September", 44, -4, 12.4, "Loose leaves were removed from the collector. The event entry gives the window occupied by the check pour."),
    ("7 October", 39, 1, 11.2, "The downstream willow was visible from the fixed camera point. A detail image shows the bank just beneath its exposed roots."),
    ("21 October", 46, -2, 10.1, "The clock comparison was entered before any adjustment. The observer copied the recorder's zone from its own display."),
    ("4 November", 47, 3, 9.2, "Rain began before the second hand reading. The series rose through the visit and the signed sheet records both gauge observations."),
    ("18 November", 50, -3, 8.0, "The month-end drawer count was still pending. No allocation was made from the loose stock in the return tray."),
    ("2 December", 45, 1, 7.2, "The outgoing observer recorded the pouch number beside the closing signature. The next blank opening line was left ready for use."),
]


def text(c, x, y, value, font="Helvetica", size=10.4, color=INK):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, value)


def paragraph(c, value, y, width=416):
    for line in simpleSplit(value, "Helvetica", 11, width):
        text(c, 47, y, line, size=11)
        y -= 16
    return y - 11


def footer(c, page):
    c.setStrokeColor(RULE)
    c.line(47, 44, 463, 44)
    text(c, 47, 29, "Alder Beck Field Station", size=9, color=MUTED)
    c.setFillColor(MUTED)
    c.drawRightString(463, 29, f"{page} / {len(CHAPTERS) + len(VISITS) + 1}")
    c.showPage()


def table(c, label, headers, rows, y):
    text(c, 47, y, label, "Helvetica-Bold", 12)
    y -= 30
    c.setFillColor(WASH)
    c.rect(47, y - 6, 416, 23, fill=1, stroke=0)
    for i, row in enumerate([headers, *rows]):
        for column, value in enumerate(row):
            text(c, (54, 196, 328)[column], y, value, "Helvetica-Bold" if i == 0 else "Helvetica", 9.5)
        c.setStrokeColor(RULE)
        c.line(47, y - 7, 463, y - 7)
        y -= 23
    return y


def cover(c):
    text(c, 47, 657, "Alder Beck Field Station", "Helvetica-Bold", 14, GREEN)
    text(c, 44, 591, "Maintenance", "Times-Roman", 55)
    text(c, 44, 534, "handbook", "Times-Italic", 55)
    text(c, 47, 493, "Gauge readings, sample custody and field records", size=14)
    c.setFillColor(WASH)
    c.roundRect(47, 295, 416, 164, 4, fill=1, stroke=0)
    c.setStrokeColor(GREEN)
    c.setLineWidth(1.3)
    path = c.beginPath()
    path.moveTo(60, 402)
    path.curveTo(99, 404, 111, 382, 148, 376)
    path.curveTo(187, 372, 203, 328, 243, 328)
    path.curveTo(280, 324, 319, 351, 350, 382)
    path.curveTo(387, 406, 411, 396, 450, 414)
    c.drawPath(path)
    c.setStrokeColor(MUTED)
    c.setDash(3, 3)
    c.line(168, 363, 330, 363)
    c.setDash()
    c.line(310, 354, 310, 413)
    for i in range(6):
        c.line(310, 359+i*9, 316, 359+i*9)
    text(c, 65, 432, "Stream cross-section", "Helvetica-Bold", 10, GREEN)
    text(c, 189, 368, "Water line", size=9, color=MUTED)
    text(c, 321, 410, "Staff gauge", size=9, color=MUTED)
    text(c, 65, 306, "Schematic section looking upstream", size=9, color=MUTED)
    y = paragraph(c, "This field copy covers one gauging reach from the north footbridge to the downstream willow. Each section records an observation, the instrument or sheet it belongs to, and the evidence that should survive the visit.", 261)
    y = paragraph(c, "The archive schedule and the walkover instructions each survive in two conflicting versions. Both versions are reproduced so a reader can cite the disagreement.", y)
    text(c, 47, 83, "Original fictional reference for Leafmark. Public domain dedication (CC0 1.0).", size=9, color=MUTED)
    footer(c, 1)


def log_page(c, page, visit, ordinal):
    date, base, change, temp, note = visit
    text(c, 47, 658, "Recorder archive", size=11, color=GREEN)
    text(c, 45, 604, f"{date} 2025", "Times-Roman", 32)
    y = paragraph(c, note, 568)
    text(c, 47, y-6, "Morning series", "Helvetica-Bold", 12)
    y -= 37
    c.setFillColor(WASH)
    c.rect(47, y-5, 416, 20, fill=1, stroke=0)
    columns = (53, 115, 201, 293, 383)
    for pos, header in zip(columns, ["UTC", "Level (cm)", "Staff (cm)", "Water (C)", "Load (V)"]):
        text(c, pos, y, header, "Helvetica-Bold", 9.5)
    for i in range(22):
        y -= 16
        level = base + change*i/21 + 0.2*sin(i/3 + ordinal)
        cells = [
            f"{6+i//4:02d}:{15*(i%4):02d}", f"{level:.1f}",
            str(round(level)) if i in (4, 20) else "-",
            f"{temp+0.04*i+0.1*sin(i/4):.1f}", f"{12.15+0.02*i+0.07*sin(ordinal):.2f}",
        ]
        for pos, value in zip(columns, cells):
            text(c, pos, y, value, size=9.5)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.35)
        c.line(47, y-5, 463, y-5)
    text(c, 47, y-29, "A dash indicates that no hand reading was taken at that time.", size=9, color=MUTED)
    footer(c, page)


def main():
    target = ROOT / "public/sample.pdf"
    target.parent.mkdir(exist_ok=True)
    c = Canvas(str(target), pagesize=PAPER, invariant=1)
    c.setTitle("Alder Beck Field Station - Maintenance handbook")
    c.setAuthor("Leafmark")
    cover(c)
    for page, (title, body, label, headers, rows) in enumerate(CHAPTERS, 2):
        text(c, 47, 658, "Maintenance handbook", size=11, color=GREEN)
        text(c, 45, 604, title, "Times-Roman", 32)
        y = 560
        for part in dedent(body).split("\n\n"):
            y = paragraph(c, part.strip(), y)
        bottom = table(c, label, headers, rows, y - 10)
        if bottom < 48:
            raise ValueError(f"Page {page} content extends below the footer")
        footer(c, page)
    for ordinal, visit in enumerate(VISITS):
        log_page(c, len(CHAPTERS) + 2 + ordinal, visit, ordinal)
    c.save()


if __name__ == "__main__":
    main()
