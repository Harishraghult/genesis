import hmac
import hashlib
from typing import Optional, Tuple, List
from .config import settings

def compute_salted_bssid_hash(bssid: str, salt: Optional[str] = None) -> str:
    """
    Computes a per-session salted HMAC-SHA256 for an Access Point BSSID.
    This allows verification against known room APs without persisting or transmitting raw BSSIDs.
    """
    effective_salt = (salt or settings.SESSION_SALT).encode("utf-8")
    return hmac.new(effective_salt, bssid.encode("utf-8"), hashlib.sha256).hexdigest()

def get_allowed_room_bssid_hashes(salt: Optional[str] = None) -> List[str]:
    """
    Returns the set of salted hashes for all valid APs in the room.
    """
    return [compute_salted_bssid_hash(ap, salt) for ap in settings.TARGET_ROOM_BSSIDS]

def evaluate_punch_anomaly(
    student_id: str,
    bssid_match: Optional[bool] = None,
    salted_bssid_hmac: Optional[str] = None,
    reported_bssid: Optional[str] = None,
    device_fingerprint: Optional[str] = None,
    client_ip: Optional[str] = None,
    is_simulation: bool = False
) -> Tuple[bool, Optional[str]]:
    """
    Evaluates attendance punch for network presence verification.
    
    PRIVACY & FAIRNESS GUARANTEES:
    1. Multi-AP room support: rooms with multiple access points / 2.4G & 5G bands
       roam seamlessly without false flags.
    2. Data minimization: client transmits on-device pass/fail (bssid_match) or a per-session
       salted HMAC. Raw BSSIDs are NEVER stored or required.
    3. Device fingerprints are NEVER used as proof of fraud: shared lab tablets,
       randomized MAC addresses (Android/iOS default), and Private DNS (DoH/DoT)
       are recognized as standard privacy features and NOT treated as fraud.
    4. Advisory only: Automated verdicts never affect grades.
    
    Returns (is_anomaly, advisory_message)
    """
    # 1. Simulation attack hook for demo
    if is_simulation or reported_bssid == "SIMULATED_ROGUE_BSSID":
        return True, "NETWORK_VERIFICATION_NEEDED: Synthetic Rogue Subnet / External BSSID"

    # 2. Check on-device pass/fail attestation (Item 4)
    if bssid_match is not None:
        if not bssid_match:
            return True, "NETWORK_VERIFICATION_NEEDED: Classroom Access Point verification needed"
        return False, None

    # 3. Check per-session salted HMAC (Item 4)
    if salted_bssid_hmac:
        allowed_hashes = get_allowed_room_bssid_hashes(settings.SESSION_SALT)
        if salted_bssid_hmac not in allowed_hashes:
            return True, "NETWORK_VERIFICATION_NEEDED: Access point HMAC does not match room AP list"
        return False, None

    # 4. Check legacy reported_bssid against multi-AP list (Item 5)
    if reported_bssid:
        if reported_bssid not in settings.TARGET_ROOM_BSSIDS and reported_bssid != settings.TARGET_BSSID:
            return True, "NETWORK_VERIFICATION_NEEDED: Access Point not in room AP list"
        return False, None

    # Default to verified
    return False, None

def reset_anomaly_tracker():
    """No-op tracker reset retained for test & API compatibility."""
    pass
