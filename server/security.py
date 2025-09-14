"""
Security utilities for the Olexi Extension Host
"""
import re
import hashlib
from typing import Optional
from fastapi import HTTPException, Request

def validate_chrome_extension_request(request: Request) -> bool:
    """Validate that the request comes from the trusted browser context.

    Originally this only allowed chrome-extension:// origins. We now also allow
    direct content-script initiated requests from austlii.edu.au pages, because
    MV3 content scripts may present the page origin in the fetch Origin header.
    Additional checks (Chrome UA and fingerprint header) remain required.
    """
    origin = request.headers.get("origin") or ""
    user_agent = request.headers.get("user-agent", "")
    fingerprint_present = bool(request.headers.get("x-extension-fingerprint"))

    if not fingerprint_present:
        return False

    # Must look like Chrome
    if not re.search(r"Chrome/\d+", user_agent):
        return False

    # Accept either the extension origin or austlii.edu.au (any subdomain)
    if origin.startswith("chrome-extension://"):
        return True
    if re.match(r"https://([a-z0-9-]+\.)*austlii\.edu\.au/?$", origin):
        return True

    return False

def validate_fingerprint_format(fingerprint: str) -> bool:
    """Validate that the fingerprint has the expected format"""
    if not fingerprint:
        return False
    
    # Should be 32 character hex string
    if len(fingerprint) != 32:
        return False
    
    # Should only contain hex characters
    if not re.match(r'^[a-f0-9]{32}$', fingerprint):
        return False
    
    return True

def get_client_ip(request: Request) -> str:
    """Get the real client IP, considering proxies"""
    # Check common proxy headers
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        # Take the first IP in the chain
        return forwarded_for.split(",")[0].strip()
    
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    
    # Fallback to direct connection
    if hasattr(request, "client") and request.client:
        return request.client.host
    
    return "unknown"

def is_suspicious_request(request: Request, fingerprint: str) -> bool:
    """Detect potentially suspicious requests"""
    
    # Check for common automation indicators
    user_agent = request.headers.get("user-agent", "").lower()
    
    # Common bot/automation tools
    suspicious_agents = [
        'curl', 'wget', 'python', 'bot', 'crawler', 'spider',
        'automated', 'selenium', 'phantomjs', 'headless'
    ]
    
    if any(agent in user_agent for agent in suspicious_agents):
        return True
    
    # Check for missing standard browser headers
    if not request.headers.get("accept-language"):
        return True
    
    if not request.headers.get("accept-encoding"):
        return True
    
    # Check for suspicious fingerprint patterns
    # (e.g., all zeros, repeating patterns)
    if fingerprint == "0" * 32 or len(set(fingerprint)) < 4:
        return True
    
    return False
