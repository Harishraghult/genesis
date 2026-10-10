import os

class Settings:
    PROJECT_NAME: str = "FocusLock"
    PROJECT_VERSION: str = "1.0.0"
    
    # Cryptographic & Auth keys
    INSTRUCTOR_KEY: str = os.getenv("FL_INSTRUCTOR_KEY", "dev-instructor-key")
    JWT_SECRET: str = os.getenv("FL_JWT_SECRET", "super-secret-focuslock-jwt-key-2026")
    JWT_ALGORITHM: str = "HS256"
    TOTP_SECRET: str = os.getenv("FL_TOTP_SECRET", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")
    SESSION_SECRET: str = os.getenv("FL_SESSION_SECRET", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff")
    
    # Class environment settings: multiple APs per room (avoids false positives during roaming)
    TOTP_STEP_SECONDS: int = 15
    SIG_MAX_SKEW_SECONDS: int = 30
    TARGET_BSSID: str = os.getenv("FL_TARGET_BSSID", "BSSID_ROOM_302")
    TARGET_ROOM_BSSIDS: list[str] = [
        "BSSID_ROOM_302",
        "BSSID_ROOM_302_AP2",
        "BSSID_ROOM_302_5G",
        "BSSID_ROOM_302_EAST",
    ]
    TARGET_CLASSROOM_NETS: list[str] = ["127.0.0.1/32", "192.168.0.0/16", "10.0.0.0/8"]
    EMERGENCY_NUMBER: str = os.getenv("FL_EMERGENCY_NUMBER", "112")
    SESSION_SALT: str = os.getenv("FL_SESSION_SALT", "fl_salt_2026_room302_privacy")
    RETENTION_DAYS: int = int(os.getenv("FL_RETENTION_DAYS", "30"))
    
    # Development bypass flags
    DEV_MODE: bool = True

settings = Settings()
