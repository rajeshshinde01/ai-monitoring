"""Small local authentication store for PulseOps development and internal use."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class AccountLockedError(ValueError):
    """Raised when a local account is temporarily locked after failed sign-ins."""


class LocalAuth:
    VALID_ROLES = {"administrator", "developer", "readonly"}

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.users_file = data_dir / "users.json"
        self.sessions_file = data_dir / "sessions.json"
        self.domain = os.getenv("AUTH_ALLOWED_EMAIL_DOMAIN", "db.com").lower().lstrip("@")
        self.admin_emails = {email.strip().lower() for email in os.getenv("AUTH_BOOTSTRAP_ADMIN_EMAILS", "").split(",") if email.strip()}
        self._migrate_legacy_roles()
        self._promote_configured_administrators()
        self._ensure_break_glass_admin()

    def _read(self, path: Path, default: Any) -> Any:
        try:
            value = json.loads(path.read_text())
            return value if isinstance(value, type(default)) else default
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return default

    def _write(self, path: Path, value: Any) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n")
        temporary.replace(path)

    def _password_hash(self, password: str, salt: str | None = None) -> tuple[str, str]:
        salt = salt or secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 310_000).hex()
        return digest, salt

    @staticmethod
    def _parse_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None

    @staticmethod
    def _login_attempt_limit() -> int:
        return max(1, int(os.getenv("AUTH_MAX_LOGIN_ATTEMPTS", "5")))

    @staticmethod
    def _lockout_minutes() -> int:
        return max(1, int(os.getenv("AUTH_LOCKOUT_MINUTES", "30")))

    def _ensure_break_glass_admin(self) -> None:
        """Create an explicitly enabled local emergency administrator.

        It is intentionally disabled by default and never has a built-in password.
        """
        if os.getenv("AUTH_ENABLE_BREAK_GLASS_ADMIN", "false").lower() != "true":
            return
        users = self._read(self.users_file, [])
        username = os.getenv("AUTH_BREAK_GLASS_USERNAME", "admin").strip().lower()
        if any(user.get("email") == username for user in users):
            return
        password = os.getenv("AUTH_BREAK_GLASS_PASSWORD", "")
        if len(password) < 12:
            return
        digest, salt = self._password_hash(password)
        users.append({"email": username, "name": "Break-glass Administrator", "role": "administrator", "password_hash": digest, "salt": salt, "created_at": self._now(), "failed_login_attempts": 0, "locked_until": None})
        self._write(self.users_file, users)

    def _migrate_legacy_roles(self) -> None:
        """Map the original generic user role to the operational developer role."""
        users = self._read(self.users_file, [])
        changed = False
        for user in users:
            if user.get("role") == "user":
                user["role"] = "developer"
                changed = True
        if changed:
            self._write(self.users_file, users)

    def _promote_configured_administrators(self) -> None:
        """Keep configured bootstrap administrators in sync with existing local accounts."""
        if not self.admin_emails:
            return
        users = self._read(self.users_file, [])
        changed = False
        for user in users:
            if str(user.get("email", "")).lower() in self.admin_emails and user.get("role") != "administrator":
                user["role"] = "administrator"
                changed = True
        if changed:
            self._write(self.users_file, users)

    def break_glass_setup_available(self) -> bool:
        if not self.break_glass_enabled():
            return False
        username = os.getenv("AUTH_BREAK_GLASS_USERNAME", "admin").strip().lower()
        return not any(user.get("email") == username for user in self._read(self.users_file, []))

    @staticmethod
    def break_glass_enabled() -> bool:
        return os.getenv("AUTH_ENABLE_BREAK_GLASS_ADMIN", "false").lower() == "true"

    def bootstrap_break_glass_admin(self, password: str) -> dict[str, str]:
        if not self.break_glass_setup_available():
            raise ValueError("Initial administrator setup is unavailable or already complete.")
        if len(password) < 12:
            raise ValueError("Use a password with at least 12 characters for the administrator account.")
        username = os.getenv("AUTH_BREAK_GLASS_USERNAME", "admin").strip().lower()
        users = self._read(self.users_file, [])
        digest, salt = self._password_hash(password)
        user = {"email": username, "name": "Break-glass Administrator", "role": "administrator", "password_hash": digest, "salt": salt, "created_at": self._now(), "failed_login_attempts": 0, "locked_until": None}
        users.append(user)
        self._write(self.users_file, users)
        return self.public_user(user)

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _allowed_email(self, email: str) -> bool:
        return email.endswith(f"@{self.domain}")

    def register(self, email: str, password: str, name: str) -> dict[str, str]:
        email = email.strip().lower()
        name = name.strip() or email.split("@", 1)[0]
        if not self._allowed_email(email):
            raise ValueError(f"Use your approved @{self.domain} email address.")
        if len(password) < 10:
            raise ValueError("Use a password with at least 10 characters.")
        users = self._read(self.users_file, [])
        if any(user.get("email") == email for user in users):
            raise ValueError("This account already exists. Sign in instead.")
        digest, salt = self._password_hash(password)
        user = {"email": email, "name": name[:100], "role": "administrator" if email in self.admin_emails else "developer", "password_hash": digest, "salt": salt, "created_at": self._now(), "failed_login_attempts": 0, "locked_until": None}
        users.append(user)
        self._write(self.users_file, users)
        return self.public_user(user)

    def upsert_oidc_user(self, email: str, name: str) -> dict[str, Any]:
        """Create or refresh a local access record after a verified OIDC sign-in."""
        email = email.strip().lower()
        if not self._allowed_email(email):
            raise ValueError(f"Use your approved @{self.domain} email address.")
        users = self._read(self.users_file, [])
        user = next((item for item in users if str(item.get("email", "")).lower() == email), None)
        if user is None:
            user = {"email": email, "name": (name.strip() or email.split("@", 1)[0])[:100], "role": "administrator" if email in self.admin_emails else "developer", "auth_source": "oidc", "created_at": self._now(), "failed_login_attempts": 0, "locked_until": None}
            users.append(user)
        else:
            user["name"] = (name.strip() or user.get("name") or email.split("@", 1)[0])[:100]
            user["auth_source"] = "oidc"
            if email in self.admin_emails:
                user["role"] = "administrator"
        self._write(self.users_file, users)
        return self.public_user(user)

    @staticmethod
    def public_user(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "email": str(user["email"]),
            "name": str(user["name"]),
            "role": str(user["role"]),
            "enabled": bool(user.get("enabled", True)),
            "locked_until": user.get("locked_until"),
            "failed_login_attempts": int(user.get("failed_login_attempts", 0)),
        }

    def list_users(self) -> list[dict[str, Any]]:
        return [
            {**self.public_user(user), "created_at": str(user.get("created_at", "")), "source": str(user.get("auth_source", "local"))}
            for user in self._read(self.users_file, [])
        ]

    def get_user(self, email: str) -> dict[str, Any] | None:
        email = email.strip().lower()
        for user in self._read(self.users_file, []):
            if str(user.get("email", "")).lower() == email:
                return {**self.public_user(user), "created_at": str(user.get("created_at", "")), "source": str(user.get("auth_source", "local"))}
        return None

    def set_user_role(self, email: str, role: str, actor_email: str) -> dict[str, Any]:
        role = role.strip().lower()
        email = email.strip().lower()
        actor_email = actor_email.strip().lower()
        if role not in self.VALID_ROLES:
            raise ValueError("Choose Administrator, Developer / Operator, or Read-only.")
        if email == actor_email:
            raise ValueError("You cannot change your own active role.")
        if email in self.admin_emails and role != "administrator":
            raise ValueError("This bootstrap administrator is managed in configuration and must remain an administrator.")
        users = self._read(self.users_file, [])
        target = next((user for user in users if str(user.get("email", "")).lower() == email), None)
        if target is None:
            raise ValueError("The user account was not found.")
        if target.get("role") == "administrator" and role != "administrator" and bool(target.get("enabled", True)):
            enabled_admins = [user for user in users if user.get("role") == "administrator" and bool(user.get("enabled", True))]
            if len(enabled_admins) <= 1:
                raise ValueError("Keep at least one enabled administrator account.")
        target["role"] = role
        self._write(self.users_file, users)
        self._end_user_sessions(email)
        return {**self.public_user(target), "created_at": str(target.get("created_at", "")), "source": str(target.get("auth_source", "local"))}

    def _guard_admin_change(self, users: list[dict[str, Any]], email: str, actor_email: str) -> dict[str, Any]:
        email = email.strip().lower()
        actor_email = actor_email.strip().lower()
        if email == actor_email:
            raise ValueError("You cannot disable or delete your own active account.")
        target = next((user for user in users if str(user.get("email", "")).lower() == email), None)
        if target is None:
            raise ValueError("The user account was not found.")
        if target.get("role") == "administrator" and bool(target.get("enabled", True)):
            enabled_admins = [user for user in users if user.get("role") == "administrator" and bool(user.get("enabled", True))]
            if len(enabled_admins) <= 1:
                raise ValueError("Keep at least one enabled administrator account.")
        return target

    def _end_user_sessions(self, email: str) -> None:
        sessions = self._read(self.sessions_file, {})
        removed = [key for key, record in sessions.items() if isinstance(record, dict) and str(record.get("user", {}).get("email", "")).lower() == email.lower()]
        for key in removed:
            sessions.pop(key, None)
        if removed:
            self._write(self.sessions_file, sessions)

    def set_user_enabled(self, email: str, enabled: bool, actor_email: str) -> dict[str, Any]:
        users = self._read(self.users_file, [])
        target = self._guard_admin_change(users, email, actor_email) if not enabled else next((user for user in users if str(user.get("email", "")).lower() == email.strip().lower()), None)
        if target is None:
            raise ValueError("The user account was not found.")
        target["enabled"] = enabled
        self._write(self.users_file, users)
        if not enabled:
            self._end_user_sessions(email)
        return {**self.public_user(target), "created_at": str(target.get("created_at", "")), "source": str(target.get("auth_source", "local"))}

    def delete_user(self, email: str, actor_email: str) -> None:
        users = self._read(self.users_file, [])
        self._guard_admin_change(users, email, actor_email)
        email = email.strip().lower()
        self._write(self.users_file, [user for user in users if str(user.get("email", "")).lower() != email])
        self._end_user_sessions(email)

    def unlock_user(self, email: str, actor_email: str) -> dict[str, Any]:
        """An administrator clears a temporary lock without changing account access."""
        users = self._read(self.users_file, [])
        target = next((user for user in users if str(user.get("email", "")).lower() == email.strip().lower()), None)
        if target is None:
            raise ValueError("The user account was not found.")
        target["failed_login_attempts"] = 0
        target["locked_until"] = None
        self._write(self.users_file, users)
        return {**self.public_user(target), "created_at": str(target.get("created_at", "")), "source": str(target.get("auth_source", "local"))}

    def authenticate(self, email: str, password: str) -> dict[str, str] | None:
        email = email.strip().lower()
        if email == os.getenv("AUTH_BREAK_GLASS_USERNAME", "admin").strip().lower() and not self.break_glass_enabled():
            return None
        users = self._read(self.users_file, [])
        for user in users:
            if user.get("email") != email:
                continue
            if not bool(user.get("enabled", True)):
                return None
            if user.get("auth_source") == "oidc":
                return None
            locked_until = self._parse_datetime(user.get("locked_until"))
            if locked_until and locked_until > datetime.now(timezone.utc):
                remaining = max(1, int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1)
                raise AccountLockedError(f"This account is locked for {remaining} more minute(s). Contact an administrator to unlock it sooner.")
            if locked_until:
                user["locked_until"] = None
                user["failed_login_attempts"] = 0
            digest, _ = self._password_hash(password, str(user.get("salt", "")))
            if hmac.compare_digest(digest, str(user.get("password_hash", ""))):
                if user.get("failed_login_attempts") or user.get("locked_until"):
                    user["failed_login_attempts"] = 0
                    user["locked_until"] = None
                if email in self.admin_emails and user.get("role") != "administrator":
                    user["role"] = "administrator"
                self._write(self.users_file, users)
                return self.public_user(user)
            attempts = int(user.get("failed_login_attempts", 0)) + 1
            user["failed_login_attempts"] = attempts
            if attempts >= self._login_attempt_limit():
                user["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=self._lockout_minutes())).isoformat()
                self._write(self.users_file, users)
                self._end_user_sessions(email)
                raise AccountLockedError(f"This account is locked for {self._lockout_minutes()} minutes after repeated failed sign-in attempts. An administrator can unlock it sooner.")
            self._write(self.users_file, users)
        return None

    def start_session(self, user: dict[str, str]) -> str:
        token = secrets.token_urlsafe(32)
        sessions = self._read(self.sessions_file, {})
        self._prune_sessions(sessions)
        sessions[hashlib.sha256(token.encode()).hexdigest()] = {"user": user, "expires_at": (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()}
        self._write(self.sessions_file, sessions)
        return token

    def current_user(self, token: str | None) -> dict[str, str] | None:
        if not token:
            return None
        sessions = self._read(self.sessions_file, {})
        self._prune_sessions(sessions)
        record = sessions.get(hashlib.sha256(token.encode()).hexdigest())
        if not record:
            self._write(self.sessions_file, sessions)
            return None
        self._write(self.sessions_file, sessions)
        user = record.get("user")
        if not isinstance(user, dict):
            return None
        stored_user = next((item for item in self._read(self.users_file, []) if str(item.get("email", "")).lower() == str(user.get("email", "")).lower()), None)
        if not stored_user or not bool(stored_user.get("enabled", True)):
            sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)
            self._write(self.sessions_file, sessions)
            return None
        # Refresh an active session after an administrator address is added to config.
        if str(user.get("email", "")).lower() in self.admin_emails and user.get("role") != "administrator":
            user["role"] = "administrator"
            record["user"] = user
            self._write(self.sessions_file, sessions)
        if user.get("role") == "user":
            user["role"] = "developer"
            record["user"] = user
            self._write(self.sessions_file, sessions)
        return user

    def end_session(self, token: str | None) -> None:
        if not token:
            return
        sessions = self._read(self.sessions_file, {})
        sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)
        self._write(self.sessions_file, sessions)

    @staticmethod
    def _prune_sessions(sessions: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)
        expired = [key for key, value in sessions.items() if not isinstance(value, dict) or datetime.fromisoformat(str(value.get("expires_at"))).replace(tzinfo=timezone.utc) <= now]
        for key in expired:
            sessions.pop(key, None)
