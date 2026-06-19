"""One-time migration: merge phantom hub stock rows (location_id='hub') into
canonical (location_id='hub-main') rows then delete the phantoms.

Safe to re-run — idempotent.
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    cursor = db.stock.find({"location_type": "hub", "location_id": "hub"})
    merged = 0
    deleted = 0
    async for phantom in cursor:
        pid = phantom["product_id"]
        qty = float(phantom.get("quantity") or 0)
        # find canonical row
        canonical = await db.stock.find_one(
            {"product_id": pid, "location_type": "hub", "location_id": "hub-main"}
        )
        if canonical:
            await db.stock.update_one(
                {"id": canonical["id"]},
                {"$inc": {"quantity": qty}},
            )
            merged += 1
            await db.stock.delete_one({"id": phantom["id"]})
            deleted += 1
        else:
            # Promote phantom to canonical
            await db.stock.update_one(
                {"id": phantom["id"]},
                {"$set": {"location_id": "hub-main"}},
            )
            merged += 1
    print(f"Migration complete: merged={merged}, deleted={deleted}")

if __name__ == "__main__":
    asyncio.run(main())
