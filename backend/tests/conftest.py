"""Shared fixtures for Servall Nexus ERP backend tests."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL, "REACT_APP_BACKEND_URL not set"
    return BASE_URL


def _login(email: str, password: str):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text}")
    return r.json()


@pytest.fixture(scope="session")
def admin_token():
    return _login("admin@servall.com", "Admin@123")["token"]


@pytest.fixture(scope="session")
def accountant_token():
    return _login("accountant@servall.com", "Accountant@123")["token"]


@pytest.fixture(scope="session")
def warehouse_token():
    return _login("warehouse@servall.com", "Warehouse@123")["token"]


@pytest.fixture(scope="session")
def franchise_login():
    return _login("franchise@servall.com", "Franchise@123")


@pytest.fixture(scope="session")
def franchise_token(franchise_login):
    return franchise_login["token"]


@pytest.fixture(scope="session")
def franchise_user(franchise_login):
    return franchise_login["user"]


@pytest.fixture(scope="session")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def warehouse_client(warehouse_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {warehouse_token}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def accountant_client(accountant_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {accountant_token}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def franchise_client(franchise_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {franchise_token}",
                      "Content-Type": "application/json"})
    return s
