"""Account Management — ERP login account CRUD (v2.7).

This module is strictly for managing ERP login accounts (not employee management).
Role-aware permission rules:

  super_admin:
    - Can create/edit/disable/activate/reset-password any account
    - Can choose role: hub_accountant / warehouse_manager / franchise_manager
    - Cannot create another super_admin via this UI (kept seed-only)

  warehouse_manager:
    - Can create franchise_manager accounts ONLY
    - Can only see + edit + reset-password franchise_manager accounts whose
      franchise is in his/her assigned hub
    - Cannot touch super_admin / hub_accountant / warehouse_manager accounts

  hub_accountant / franchise_manager:
    - No access (route returns 403)
"""
from __future__ import annotations
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from auth_utils import (
    get_current_user,
    require_roles,
    hash_password,
)
from models import UserCreate, UserUpdate, UserPublic, PasswordResetIn, User, now_iso

logger = logging.getLogger(__name__)

router = APIRouter()

_db = None
_log_audit = None


def init(db, log_audit_fn):
    global _db, _log_audit
    _db = db
    _log_audit = log_audit_fn


# ---------- Permission helpers ----------
ROLE_CHOICES_FOR_SUPER_ADMIN = {"hub_accountant", "warehouse_manager", "franchise_manager"}
ROLE_CHOICES_FOR_WAREHOUSE_MANAGER = {"franchise_manager"}


def _allowed_roles_to_create(actor_role: str) -> set[str]:
    if actor_role == "super_admin":
        return ROLE_CHOICES_FOR_SUPER_ADMIN
    if actor_role == "warehouse_manager":
        return ROLE_CHOICES_FOR_WAREHOUSE_MANAGER
    return set()


async def _is_franchise_in_hub(franchise_id: Optional[str], hub_id: Optional[str]) -> bool:
    if not franchise_id or not hub_id:
        return False
    fr = await _db.franchises.find_one({"id": franchise_id}, {"_id": 0, "hub_id": 1})
    return bool(fr and fr.get("hub_id") == hub_id)


async def _can_actor_manage_account(actor: dict, target: dict) -> bool:
    """Return True if `actor` is permitted to view/edit/reset/disable `target` account."""
    if actor.get("role") == "super_admin":
        return True
    if actor.get("role") == "warehouse_manager":
        if target.get("role") != "franchise_manager":
            return False
        # Must share the hub via franchise.hub_id == warehouse_manager.hub_id
        return await _is_franchise_in_hub(target.get("franchise_id"), actor.get("hub_id"))
    return False


def _strip_password(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k != "password_hash" and k != "_id"}
    return out


# ---------- LIST ----------
@router.get("/accounts", response_model=List[UserPublic], tags=["accounts"])
async def list_accounts(actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    if actor["role"] == "super_admin":
        rows = await _db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
        return rows
    # warehouse_manager → only franchise managers under his hub
    franchises = await _db.franchises.find(
        {"hub_id": actor.get("hub_id")}, {"_id": 0, "id": 1}
    ).to_list(1000)
    fr_ids = [f["id"] for f in franchises]
    rows = await _db.users.find(
        {"role": "franchise_manager", "franchise_id": {"$in": fr_ids}},
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return rows


# ---------- GET ONE ----------
@router.get("/accounts/{aid}", response_model=UserPublic, tags=["accounts"])
async def get_account(aid: str, actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    target = await _db.users.find_one({"id": aid}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "Account not found")
    if not await _can_actor_manage_account(actor, target):
        raise HTTPException(403, "Not allowed to access this account")
    return target


# ---------- CREATE ----------
@router.post("/accounts", response_model=UserPublic, tags=["accounts"])
async def create_account(body: UserCreate, request: Request,
                          actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    role = body.role
    if role not in _allowed_roles_to_create(actor["role"]):
        raise HTTPException(403, f"{actor['role']} cannot create {role} accounts")

    # Validate role-specific requirements
    if role == "franchise_manager" and not body.franchise_id:
        raise HTTPException(400, "franchise_id is required for franchise_manager")
    if role in ("warehouse_manager", "hub_accountant") and not body.hub_id:
        # We don't fail hard for hub_accountant (some orgs are single-hub) but warehouse must have one
        if role == "warehouse_manager":
            raise HTTPException(400, "hub_id is required for warehouse_manager")

    # Warehouse manager can only create franchise managers under his own hub
    if actor["role"] == "warehouse_manager":
        if not await _is_franchise_in_hub(body.franchise_id, actor.get("hub_id")):
            raise HTTPException(403, "Franchise must belong to your assigned hub")

    # Email uniqueness
    if await _db.users.find_one({"email": body.email.lower()}, {"_id": 0, "id": 1}):
        raise HTTPException(409, "Email already in use")
    # Username uniqueness (if provided)
    if body.username:
        if await _db.users.find_one({"username": body.username}, {"_id": 0, "id": 1}):
            raise HTTPException(409, "Username already in use")

    u = User(**body.model_dump(exclude={"password"}))
    u.email = u.email.lower()
    u.created_by = actor["id"]
    doc = u.model_dump()
    doc["password_hash"] = hash_password(body.password)
    await _db.users.insert_one(doc)
    if _log_audit:
        await _log_audit(actor, "account.create", "user", u.id,
                         after={"email": u.email, "role": u.role, "hub_id": u.hub_id, "franchise_id": u.franchise_id},
                         request=request)
    return _strip_password(doc)


# ---------- UPDATE ----------
@router.put("/accounts/{aid}", response_model=UserPublic, tags=["accounts"])
async def update_account(aid: str, body: UserUpdate, request: Request,
                          actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    target = await _db.users.find_one({"id": aid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Account not found")
    if not await _can_actor_manage_account(actor, target):
        raise HTTPException(403, "Not allowed to edit this account")

    patch = body.model_dump(exclude_none=True)

    # Role escalation prevention: warehouse_manager can never change role
    if "role" in patch and actor["role"] != "super_admin":
        raise HTTPException(403, "Only super_admin can change role")
    # Even super_admin cannot promote to super_admin via this UI (seed-only)
    if "role" in patch and patch["role"] == "super_admin":
        raise HTTPException(403, "Cannot create or promote to super_admin via Account Management")

    # If warehouse_manager: ensure franchise_id stays within his hub if changed
    if actor["role"] == "warehouse_manager" and "franchise_id" in patch:
        if not await _is_franchise_in_hub(patch["franchise_id"], actor.get("hub_id")):
            raise HTTPException(403, "Franchise must belong to your assigned hub")

    # Email uniqueness on change
    if "email" in patch:
        patch["email"] = patch["email"].lower()
        if patch["email"] != target.get("email"):
            existing = await _db.users.find_one(
                {"email": patch["email"], "id": {"$ne": aid}}, {"_id": 0, "id": 1}
            )
            if existing:
                raise HTTPException(409, "Email already in use")
    # Username uniqueness
    if "username" in patch and patch["username"]:
        existing = await _db.users.find_one(
            {"username": patch["username"], "id": {"$ne": aid}}, {"_id": 0, "id": 1}
        )
        if existing:
            raise HTTPException(409, "Username already in use")

    patch["updated_at"] = now_iso()
    patch["updated_by"] = actor["id"]
    await _db.users.update_one({"id": aid}, {"$set": patch})
    after = await _db.users.find_one({"id": aid}, {"_id": 0, "password_hash": 0})
    if _log_audit:
        await _log_audit(actor, "account.update", "user", aid, after=patch, request=request)
    return after


# ---------- DEACTIVATE / ACTIVATE ----------
@router.post("/accounts/{aid}/disable", response_model=UserPublic, tags=["accounts"])
async def disable_account(aid: str, request: Request,
                           actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    target = await _db.users.find_one({"id": aid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Account not found")
    if not await _can_actor_manage_account(actor, target):
        raise HTTPException(403, "Not allowed to disable this account")
    if target["id"] == actor["id"]:
        raise HTTPException(400, "Cannot disable your own account")
    await _db.users.update_one({"id": aid}, {"$set": {
        "active": False, "updated_at": now_iso(), "updated_by": actor["id"]
    }})
    if _log_audit:
        await _log_audit(actor, "account.disable", "user", aid, request=request)
    after = await _db.users.find_one({"id": aid}, {"_id": 0, "password_hash": 0})
    return after


@router.post("/accounts/{aid}/activate", response_model=UserPublic, tags=["accounts"])
async def activate_account(aid: str, request: Request,
                            actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    target = await _db.users.find_one({"id": aid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Account not found")
    if not await _can_actor_manage_account(actor, target):
        raise HTTPException(403, "Not allowed to activate this account")
    await _db.users.update_one({"id": aid}, {"$set": {
        "active": True, "updated_at": now_iso(), "updated_by": actor["id"]
    }})
    if _log_audit:
        await _log_audit(actor, "account.activate", "user", aid, request=request)
    after = await _db.users.find_one({"id": aid}, {"_id": 0, "password_hash": 0})
    return after


# ---------- RESET PASSWORD ----------
@router.post("/accounts/{aid}/reset-password", tags=["accounts"])
async def reset_password(aid: str, body: PasswordResetIn, request: Request,
                          actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    target = await _db.users.find_one({"id": aid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Account not found")
    if not await _can_actor_manage_account(actor, target):
        raise HTTPException(403, "Not allowed to reset this account's password")
    if not body.new_password or len(body.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    await _db.users.update_one({"id": aid}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "updated_at": now_iso(),
        "updated_by": actor["id"],
    }})
    if _log_audit:
        await _log_audit(actor, "account.reset_password", "user", aid, request=request)
    return {"ok": True}


# ---------- META: roles I can assign + hubs/franchises I can see ----------
@router.get("/accounts-meta", tags=["accounts"])
async def accounts_meta(actor: dict = Depends(require_roles("super_admin", "warehouse_manager"))):
    """Returns the role options + hub/franchise options visible to the current actor."""
    roles = sorted(_allowed_roles_to_create(actor["role"]))
    hubs = await _db.hubs.find({}, {"_id": 0}).to_list(200) if "hubs" in await _db.list_collection_names() else []
    if actor["role"] == "warehouse_manager":
        franchises = await _db.franchises.find(
            {"hub_id": actor.get("hub_id")}, {"_id": 0, "id": 1, "name": 1, "hub_id": 1}
        ).to_list(500)
    else:
        franchises = await _db.franchises.find(
            {}, {"_id": 0, "id": 1, "name": 1, "hub_id": 1}
        ).to_list(500)
    return {"roles": roles, "hubs": hubs, "franchises": franchises}
