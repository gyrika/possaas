# Lume POS: test pass on a real PC (before the beta)

One copy of this list per PC. Tick each box; anything that fails: write what you saw, then Shop setup →
Help → **Save support file** (or Start menu → **Lume POS support file**) and keep the zip with this sheet.

**The PC:** Windows ______ (Home / Pro, version ____) · Antivirus ______ · Printer ______ (80 / 58 mm, USB / network) · Kitchen tablet ______

Do at least: a fresh **Windows 10 Home**, a fresh **Windows 11 Home**, one of them with **Avast** installed,
and every printer you can borrow (the XP-80T with its cash drawer, a 58 mm one).

## 1. Install (time it: ____ min)
- [ ] Download `LumePOS-Setup-x.y.z.exe` from the GitHub Release; "Windows protected your PC" → More info → Run anyway
- [ ] The antivirus lets it install and run (note any warning: ______)
- [ ] A "Lume POS" icon is on the desktop and the POS opens on "Name your shop"

## 2. Setup wizard
- [ ] Shop name and town
- [ ] Printer: listed by Windows, **or** "Set it up" for a USB printer without its driver, **or** a network printer by IP
- [ ] Paper width chosen; **Print a test receipt** → it comes out; the dashed lines reach both edges
- [ ] Answer **No** once (printer switched off): the help says it is off; switched on → Try again → prints
- [ ] **Open the cash drawer** opens it
- [ ] Staff: the owner, a manager, a cashier (each a PIN)
- [ ] Cloud: Skip for now
- [ ] Devices: the kitchen tablet scans the QR code and shows the Kitchen

## 3. Menu (time it: ____ min)
- [ ] The owner logs in and lands on "Add your menu"
- [ ] A section with 2 sizes and an extra; then 5+ items typed one after another
- [ ] Back on the Register: the section's tab, the prices on the buttons

## 4. Selling
- [ ] Tap an item; type an order (e.g. `2 full chicken kottu extra egg`)
- [ ] Send to kitchen → the ticket is on the tablet within 2 seconds, and on the PC with the Kitchen key (Left kitchen / Right kitchen in a shop with two)
- [ ] Charge cash → the receipt prints with the shop's name, the drawer opens, the change is right
- [ ] Charge a bank transfer → prints, the drawer stays shut
- [ ] Manager mode (Ctrl+M, PIN): a 10% discount, and a void with a reason → the kitchen sees "Cancelled"
- [ ] Kitchen: Done; the colour turns amber after the section's cook time

## 5. Closing
- [ ] Close the day: the numbers match what you sold; cash at opening + counted → short / over / exact; Print it
- [ ] Shop setup → Backup → Save a copy on a USB stick → the file is in "Lume POS backups" on the stick

## 6. When things go wrong
- [ ] Restart the PC → the POS opens by itself, the sales are still there
- [ ] Restart the PC 3 times: the Lume POS window opens and **stays open** every time (it closed by itself twice on Windows Server 2025 in CI; if it happens, save a support file)
- [ ] Pull the power plug in the middle of an order → after restart, nothing sent or paid is lost
- [ ] Unplug the printer, take a cash payment → the sale completes; plug it back in
- [ ] Wi-Fi/internet off → selling, the kitchen screen on the PC and receipts still work
- [ ] Support file from Shop setup → Help, and from the Start menu: the zip appears on the desktop

## 7. Uninstall and reinstall
- [ ] Uninstall from Windows Settings → Apps → the data folder `C:\ProgramData\LumePOS` stays
- [ ] Install again → the shop, menu, staff and sales are all back

**Result:** pass / fail · Biggest problem: ______________________________________________
