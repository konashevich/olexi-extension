"""
Session token management for Olexi Extension Host
Provides temporary tokens without requiring user authentication
"""
import os
import time
import secrets
import hashlib
from typing import Dict, Optional, Tuple
from collections import defaultdict
import asyncio
from fastapi import HTTPException

class SessionTokenManager:
    def __init__(self, token_lifetime_hours: int = 24, max_tokens_per_fingerprint: int = 3):
        self.token_lifetime_hours = token_lifetime_hours
        self.max_tokens_per_fingerprint = max_tokens_per_fingerprint
        self.tokens: Dict[str, Dict] = {}  # token -> {fingerprint, created_at, last_used}
        self.fingerprint_tokens: Dict[str, list] = defaultdict(list)  # fingerprint -> [tokens]
        self.lock = asyncio.Lock()
    
    def _is_token_expired(self, token_data: Dict) -> bool:
        """Check if a token has expired"""
        created_at = token_data.get("created_at", 0)
        return time.time() - created_at > (self.token_lifetime_hours * 3600)
    
    def _cleanup_expired_tokens(self):
        """Remove expired tokens"""
        expired_tokens = []
        for token, data in self.tokens.items():
            if self._is_token_expired(data):
                expired_tokens.append(token)
        
        for token in expired_tokens:
            fingerprint = self.tokens[token]["fingerprint"]
            del self.tokens[token]
            if token in self.fingerprint_tokens[fingerprint]:
                self.fingerprint_tokens[fingerprint].remove(token)
    
    async def generate_token(self, fingerprint: str) -> str:
        """Generate a new session token for a fingerprint"""
        async with self.lock:
            self._cleanup_expired_tokens()
            
            # Limit tokens per fingerprint
            current_tokens = [
                token for token in self.fingerprint_tokens[fingerprint]
                if token in self.tokens and not self._is_token_expired(self.tokens[token])
            ]
            
            # Remove oldest tokens if we're at the limit
            while len(current_tokens) >= self.max_tokens_per_fingerprint:
                oldest_token = min(current_tokens, key=lambda t: self.tokens[t]["created_at"])
                del self.tokens[oldest_token]
                current_tokens.remove(oldest_token)
                self.fingerprint_tokens[fingerprint].remove(oldest_token)
            
            # Generate new token
            token = secrets.token_urlsafe(32)
            
            # Store token data
            self.tokens[token] = {
                "fingerprint": fingerprint,
                "created_at": time.time(),
                "last_used": time.time(),
                "request_count": 0
            }
            
            self.fingerprint_tokens[fingerprint].append(token)
            
            return token
    
    async def validate_token(self, token: str, fingerprint: str) -> bool:
        """Validate a session token against a fingerprint"""
        async with self.lock:
            self._cleanup_expired_tokens()
            
            if token not in self.tokens:
                return False
            
            token_data = self.tokens[token]
            
            # Check if token belongs to this fingerprint
            if token_data["fingerprint"] != fingerprint:
                return False
            
            # Check if token is expired
            if self._is_token_expired(token_data):
                # Clean up expired token
                del self.tokens[token]
                if token in self.fingerprint_tokens[fingerprint]:
                    self.fingerprint_tokens[fingerprint].remove(token)
                return False
            
            # Update last used time and increment request count
            token_data["last_used"] = time.time()
            token_data["request_count"] += 1
            
            return True
    
    async def get_token_info(self, token: str) -> Optional[Dict]:
        """Get information about a token"""
        async with self.lock:
            self._cleanup_expired_tokens()
            
            if token not in self.tokens:
                return None
            
            token_data = self.tokens[token].copy()
            token_data["expires_at"] = token_data["created_at"] + (self.token_lifetime_hours * 3600)
            token_data["is_expired"] = self._is_token_expired(self.tokens[token])
            
            return token_data
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke a specific token"""
        async with self.lock:
            if token not in self.tokens:
                return False
            
            fingerprint = self.tokens[token]["fingerprint"]
            del self.tokens[token]
            
            if token in self.fingerprint_tokens[fingerprint]:
                self.fingerprint_tokens[fingerprint].remove(token)
            
            return True
    
    async def get_fingerprint_tokens(self, fingerprint: str) -> list:
        """Get all valid tokens for a fingerprint"""
        async with self.lock:
            self._cleanup_expired_tokens()
            
            valid_tokens = []
            for token in self.fingerprint_tokens[fingerprint]:
                if token in self.tokens and not self._is_token_expired(self.tokens[token]):
                    valid_tokens.append(token)
            
            return valid_tokens
    
    def get_stats(self) -> Dict:
        """Get statistics about token usage"""
        self._cleanup_expired_tokens()
        
        total_tokens = len(self.tokens)
        total_fingerprints = len([fp for fp, tokens in self.fingerprint_tokens.items() if tokens])
        
        # Calculate average requests per token
        total_requests = sum(data["request_count"] for data in self.tokens.values())
        avg_requests = total_requests / total_tokens if total_tokens > 0 else 0
        
        return {
            "total_active_tokens": total_tokens,
            "total_fingerprints": total_fingerprints,
            "total_requests_served": total_requests,
            "average_requests_per_token": round(avg_requests, 2),
            "token_lifetime_hours": self.token_lifetime_hours
        }

# Global session token manager
session_token_manager = SessionTokenManager(
    token_lifetime_hours=int(os.getenv("TOKEN_LIFETIME_HOURS", "24")),
    max_tokens_per_fingerprint=int(os.getenv("MAX_TOKENS_PER_FINGERPRINT", "3"))
)
