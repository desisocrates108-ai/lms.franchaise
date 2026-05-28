"""Idempotent demo data seeder for Servall Nexus ERP."""
import logging
from datetime import datetime, timezone, timedelta
from auth_utils import hash_password
from models import (
    User, Franchise, Vendor, Product, StockItem, Indent, IndentLineItem,
    DeliveryChallan, AuditLog, Notification, now_iso, gen_id,
)
import random

logger = logging.getLogger("seed")

DEMO_USERS = [
    {"email": "admin@servall.com", "password": "Admin@123", "full_name": "Servall Super Admin", "role": "super_admin"},
    {"email": "accountant@servall.com", "password": "Accountant@123", "full_name": "Hub Accountant", "role": "hub_accountant"},
    {"email": "warehouse@servall.com", "password": "Warehouse@123", "full_name": "Warehouse Manager", "role": "warehouse_manager"},
    {"email": "franchise@servall.com", "password": "Franchise@123", "full_name": "Delhi Franchise Owner", "role": "franchise_manager", "franchise_code": "FR-DEL-001"},
]

DEMO_FRANCHISES = [
    {"code": "FR-DEL-001", "name": "Servall Delhi Connaught Place", "city": "Delhi", "state": "Delhi",
     "address": "Block A, Connaught Place, New Delhi", "gstin": "07AAACS1234A1Z5",
     "contact_phone": "+91-9810000001", "contact_email": "delhi.cp@servall.com", "credit_limit": 500000},
    {"code": "FR-MUM-002", "name": "Servall Mumbai Andheri", "city": "Mumbai", "state": "Maharashtra",
     "address": "Andheri West, Mumbai", "gstin": "27AAACS1234A1Z5",
     "contact_phone": "+91-9820000002", "contact_email": "mumbai.andheri@servall.com", "credit_limit": 400000},
    {"code": "FR-BLR-003", "name": "Servall Bangalore Indiranagar", "city": "Bangalore", "state": "Karnataka",
     "address": "100ft Road, Indiranagar", "gstin": "29AAACS1234A1Z5",
     "contact_phone": "+91-9880000003", "contact_email": "blr.indi@servall.com", "credit_limit": 600000},
    {"code": "FR-PUN-004", "name": "Servall Pune Kothrud", "city": "Pune", "state": "Maharashtra",
     "address": "Kothrud, Pune", "gstin": "27BBACS1234A1Z5",
     "contact_phone": "+91-9890000004", "contact_email": "pune.kothrud@servall.com", "credit_limit": 350000},
]

DEMO_VENDORS = [
    {"code": "V-001", "name": "Bajaj Auto Genuine Parts Pvt Ltd", "gstin": "27AAACB1234A1Z5",
     "address": "Akurdi, Pune", "contact_phone": "+91-2027471234", "contact_email": "parts@bajaj.com",
     "credit_period_days": 45, "credit_limit": 2000000, "rating": 4.8, "fulfillment_score": 97.5},
    {"code": "V-002", "name": "Hero MotoCorp Spares Hub", "gstin": "06AAACH1234A1Z5",
     "address": "Gurugram, Haryana", "contact_phone": "+91-1244780000", "contact_email": "spares@hero.com",
     "credit_period_days": 30, "credit_limit": 1500000, "rating": 4.5, "fulfillment_score": 94.2},
    {"code": "V-003", "name": "TVS Motor Spare Distribution", "gstin": "33AAACT1234A1Z5",
     "address": "Hosur, Tamil Nadu", "contact_phone": "+91-4344277000", "contact_email": "dist@tvs.com",
     "credit_period_days": 30, "credit_limit": 1200000, "rating": 4.6, "fulfillment_score": 95.0},
    {"code": "V-004", "name": "Bosch Auto Components", "gstin": "29AAACB1235A1Z5",
     "address": "Bangalore", "contact_phone": "+91-8067577777", "contact_email": "auto@bosch.com",
     "credit_period_days": 60, "credit_limit": 2500000, "rating": 4.9, "fulfillment_score": 98.1},
    {"code": "V-005", "name": "Castrol India Lubricants", "gstin": "27AAACC1234A1Z5",
     "address": "Mumbai", "contact_phone": "+91-2266984000", "contact_email": "oil@castrol.com",
     "credit_period_days": 30, "credit_limit": 1000000, "rating": 4.7, "fulfillment_score": 96.0},
    {"code": "V-006", "name": "MRF Tyres Spare Network", "gstin": "33AAACM1234A1Z5",
     "address": "Chennai", "contact_phone": "+91-4424629000", "contact_email": "tyres@mrf.com",
     "credit_period_days": 45, "credit_limit": 1800000, "rating": 4.4, "fulfillment_score": 92.5},
]

DEMO_PRODUCTS = [
    # (sku, name, brand, category, subcat, oem, hsn, unit, mrp, landing, safety, rack, vendor_idx)
    ("SPK-BAJ-001", "Bajaj Pulsar 150 Spark Plug NGK", "NGK", "Engine Parts", "Spark Plug", "PLS150-SPK-01", "8511", "pcs", 380, 250, 30, "Rack A - Shelf 2 - Bin 5", 0),
    ("SPK-HER-002", "Hero Splendor Spark Plug Champion", "Champion", "Engine Parts", "Spark Plug", "SPL-SPK-CH", "8511", "pcs", 220, 145, 40, "Rack A - Shelf 2 - Bin 6", 1),
    ("AIR-BAJ-003", "Bajaj Pulsar 220 Air Filter", "OE Bajaj", "Engine Parts", "Air Filter", "PLS220-AF", "8421", "pcs", 450, 290, 25, "Rack A - Shelf 3 - Bin 1", 0),
    ("AIR-TVS-004", "TVS Apache Air Filter Premium", "OE TVS", "Engine Parts", "Air Filter", "APA-AF-PREM", "8421", "pcs", 520, 340, 20, "Rack A - Shelf 3 - Bin 2", 2),
    ("BRK-BAJ-005", "Bajaj Disc Brake Pad Front Set", "Bosch", "Brakes", "Brake Pad", "PLS-BP-F-SET", "8708", "set", 850, 540, 40, "Rack B - Shelf 1 - Bin 3", 3),
    ("BRK-HER-006", "Hero HF Brake Shoe Rear Pair", "OE Hero", "Brakes", "Brake Shoe", "HF-BS-R", "8708", "set", 620, 380, 50, "Rack B - Shelf 1 - Bin 4", 1),
    ("BRK-TVS-007", "TVS Jupiter Brake Pad Pair", "OE TVS", "Brakes", "Brake Pad", "JUP-BP-PAIR", "8708", "set", 720, 460, 35, "Rack B - Shelf 1 - Bin 5", 2),
    ("OIL-CAS-008", "Castrol Power 1 4T 20W-40 1L", "Castrol", "Lubricants", "Engine Oil", "CAS-P1-1L", "2710", "ltr", 690, 510, 60, "Rack C - Shelf 1 - Bin 1", 4),
    ("OIL-CAS-009", "Castrol Activ 4T 15W-50 900ml", "Castrol", "Lubricants", "Scooter Oil", "CAS-ACT-900", "2710", "ltr", 410, 290, 70, "Rack C - Shelf 1 - Bin 2", 4),
    ("OIL-CAS-010", "Castrol Coolant Premium 1L", "Castrol", "Lubricants", "Coolant", "CAS-COL-1L", "3820", "ltr", 380, 240, 40, "Rack C - Shelf 2 - Bin 1", 4),
    ("TYR-MRF-011", "MRF Zapper FS1 90/90-17 Tubeless", "MRF", "Tyres", "Rear Tyre", "MRF-ZAP-FS1", "4011", "pcs", 2480, 1780, 15, "Rack D - Shelf 1 - Bin 1", 5),
    ("TYR-MRF-012", "MRF Nylogrip Plus 80/100-18", "MRF", "Tyres", "Front Tyre", "MRF-NG-PLUS", "4011", "pcs", 1980, 1390, 12, "Rack D - Shelf 1 - Bin 2", 5),
    ("CHN-BAJ-013", "Bajaj Pulsar Chain Sprocket Kit", "OE Bajaj", "Transmission", "Chain Kit", "PLS-CHN-KIT", "8714", "set", 1850, 1180, 18, "Rack E - Shelf 2 - Bin 1", 0),
    ("CHN-HER-014", "Hero Splendor Chain Sprocket Kit", "OE Hero", "Transmission", "Chain Kit", "SPL-CHN-KIT", "8714", "set", 1490, 950, 22, "Rack E - Shelf 2 - Bin 2", 1),
    ("BAT-EXD-015", "Exide 12V 9Ah Battery (Maintenance Free)", "Exide", "Electrical", "Battery", "EXD-12V9AH", "8507", "pcs", 1850, 1290, 14, "Rack F - Shelf 1 - Bin 1", 3),
    ("LMP-PHL-016", "Philips Headlight Bulb 12V 35/35W", "Philips", "Electrical", "Bulb", "PHL-HL-3535", "8539", "pcs", 280, 175, 60, "Rack F - Shelf 2 - Bin 1", 3),
    ("CLU-BAJ-017", "Bajaj Clutch Plate Set", "OE Bajaj", "Transmission", "Clutch", "PLS-CLU-SET", "8714", "set", 980, 640, 25, "Rack E - Shelf 3 - Bin 1", 0),
    ("MIR-001-018", "Universal Rear View Mirror Pair", "Generic", "Body Parts", "Mirror", "UNI-MIR-PAIR", "7009", "set", 320, 180, 30, "Rack G - Shelf 1 - Bin 1", 2),
    ("CBL-BAJ-019", "Bajaj Throttle Cable", "OE Bajaj", "Body Parts", "Cable", "PLS-THR-CBL", "8714", "pcs", 180, 95, 50, "Rack G - Shelf 2 - Bin 1", 0),
    ("HRN-MIN-020", "Minda Roots Horn 12V", "Minda", "Electrical", "Horn", "MIN-RT-HRN", "8512", "pcs", 420, 270, 25, "Rack F - Shelf 3 - Bin 1", 3),
]


async def seed_demo_data(db):
    """Idempotent seed - only inserts if collections are empty."""
    try:
        existing_users = await db.users.count_documents({})
        if existing_users > 0:
            logger.info("Demo data already seeded, skipping.")
            return

        logger.info("Seeding demo data...")

        # Franchises
        franchise_ids = {}
        for f in DEMO_FRANCHISES:
            fr = Franchise(**f)
            await db.franchises.insert_one(fr.model_dump())
            franchise_ids[f["code"]] = fr.id

        # Users
        for u in DEMO_USERS:
            payload = {k: v for k, v in u.items() if k not in {"password", "franchise_code"}}
            user = User(**payload, franchise_id=franchise_ids.get(u.get("franchise_code", "")))
            doc = user.model_dump()
            doc["password_hash"] = hash_password(u["password"])
            await db.users.insert_one(doc)

        # Vendors
        vendor_ids = []
        for v in DEMO_VENDORS:
            vendor = Vendor(**v)
            await db.vendors.insert_one(vendor.model_dump())
            vendor_ids.append(vendor.id)

        # Products + initial stock
        product_ids = []
        for (sku, name, brand, cat, sub, oem, hsn, unit, mrp, landing, safety, rack, vidx) in DEMO_PRODUCTS:
            margin = 22.0
            p = Product(
                sku=sku, name=name, brand=brand, category=cat, subcategory=sub,
                part_number_oem=oem, part_number_aftermarket=oem.replace("OE-", "AM-"),
                hsn_code=hsn, barcode=f"890{random.randint(1000000000, 9999999999)}",
                unit=unit, mrp=mrp, landing_price=landing,
                franchise_price=round(landing * (1 + margin / 100), 2),
                retail_price=round(landing * (1 + (margin + 8) / 100), 2),
                margin_percent=margin,
                safety_stock=safety, reorder_qty=safety * 3,
                rack_location=rack,
                primary_vendor_id=vendor_ids[vidx],
                gst_rate=18.0,
            )
            await db.products.insert_one(p.model_dump())
            product_ids.append(p.id)

            # Stock at hub: random between safety*0.5 and safety*5
            qty = random.randint(int(safety * 0.5), safety * 5)
            days_ago = random.randint(1, 400)
            last_in = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
            await db.stock.insert_one(StockItem(
                product_id=p.id, location_type="hub", location_id="hub-main",
                quantity=qty, last_in_date=last_in,
            ).model_dump())

            # Stock at franchises: small qty
            for fcode, fid in franchise_ids.items():
                fqty = random.randint(0, max(2, safety // 4))
                if fqty > 0:
                    await db.stock.insert_one(StockItem(
                        product_id=p.id, location_type="franchise", location_id=fid,
                        quantity=fqty,
                        last_in_date=(datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).isoformat(),
                    ).model_dump())

        # Some vendor outstanding balances
        for vid in vendor_ids[:4]:
            await db.vendors.update_one({"id": vid}, {"$set": {
                "outstanding_balance": round(random.uniform(25000, 350000), 2),
            }})

        # Demo indents - 1 delivered, 1 requested, 1 dispatched
        all_products = await db.products.find({}, {"_id": 0}).to_list(100)
        franchise_list = list(franchise_ids.items())

        async def _make_indent(fcode_id, status, items_count=4, priority="routine"):
            fid = fcode_id[1]
            fname = next(f["name"] for f in DEMO_FRANCHISES if f["code"] == fcode_id[0])
            sample = random.sample(all_products, items_count)
            li = []
            total = 0.0
            for p in sample:
                qty = random.randint(2, 10)
                price = p["franchise_price"]
                allocated = qty if status in {"dispatched", "delivered"} else (qty if status == "approved" else 0)
                li.append(IndentLineItem(
                    product_id=p["id"], product_name=p["name"], sku=p["sku"],
                    requested_qty=qty, allocated_qty=allocated,
                    backorder_qty=qty - allocated,
                    unit_price=price, line_total=round(price * qty, 2),
                ).model_dump())
                total += price * qty
            num_doc = await db.counters.find_one_and_update(
                {"_id": "indent"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
            )
            num = f"IND-{str((num_doc or {}).get('seq', 1)).zfill(4)}"
            ind = Indent(
                indent_number=num, franchise_id=fid, franchise_name=fname,
                priority=priority, status=status, line_items=[IndentLineItem(**i) for i in li],
                total_amount=round(total, 2),
                fulfillment_ratio=100.0 if status in {"dispatched", "delivered", "approved"} else 0,
                approved_at=now_iso() if status != "requested" else None,
                dispatched_at=now_iso() if status in {"dispatched", "delivered"} else None,
                delivered_at=now_iso() if status == "delivered" else None,
            )
            await db.indents.insert_one(ind.model_dump())
            return ind

        await _make_indent(franchise_list[0], "requested", 3, "urgent")
        await _make_indent(franchise_list[1], "approved", 4)
        await _make_indent(franchise_list[2], "dispatched", 5)
        await _make_indent(franchise_list[3], "delivered", 4)
        await _make_indent(franchise_list[0], "delivered", 3)

        # Welcome notifications
        await db.notifications.insert_many([
            Notification(role="super_admin", title="Welcome to Servall Nexus",
                         body="Your ERP is live. Demo data has been seeded.",
                         level="success").model_dump(),
            Notification(role="warehouse_manager", title="5 SKUs need restock",
                         body="Run auto-PO to generate purchase orders.",
                         level="warning", link="/purchase-orders").model_dump(),
        ])

        logger.info("Demo data seeded successfully.")
    except Exception:
        logger.exception("Seed failed")
