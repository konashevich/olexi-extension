"""
Rate limiting implementation for Olexi Extension Host
"""
import os
import time
from typing import Dict, Optional
from collections import defaultdict
import asyncio
from fastapi import HTTPException

class RateLimiter:
    def __init__(self, requests_per_day: int = 50, requests_per_hour: int = 10):
        self.requests_per_day = requests_per_day
        self.requests_per_hour = requests_per_hour
        self.daily_counts: Dict[str, Dict[str, int]] = defaultdict(dict)  # fingerprint -> {date: count}
        self.hourly_counts: Dict[str, Dict[str, int]] = defaultdict(dict)  # fingerprint -> {hour: count}
        self.lock = asyncio.Lock()
    
    def _get_date_key(self) -> str:
        return time.strftime("%Y-%m-%d")
    
    def _get_hour_key(self) -> str:
        return time.strftime("%Y-%m-%d-%H")
    
    async def check_and_increment(self, fingerprint: str) -> None:
        """Check rate limits and increment counters"""
        async with self.lock:
            date_key = self._get_date_key()
            hour_key = self._get_hour_key()
            
            # Clean old entries (keep only current day and hour)
            self._cleanup_old_entries(fingerprint, date_key, hour_key)
            
            # Check daily limit
            daily_count = self.daily_counts[fingerprint].get(date_key, 0)
            if daily_count >= self.requests_per_day:
                raise HTTPException(
                    status_code=429, 
                    detail=f"Daily limit exceeded. Max {self.requests_per_day} requests per day."
                )
            
            # Check hourly limit
            hourly_count = self.hourly_counts[fingerprint].get(hour_key, 0)
            if hourly_count >= self.requests_per_hour:
                raise HTTPException(
                    status_code=429,
                    detail=f"Hourly limit exceeded. Max {self.requests_per_hour} requests per hour."
                )
            
            # Increment counters
            self.daily_counts[fingerprint][date_key] = daily_count + 1
            self.hourly_counts[fingerprint][hour_key] = hourly_count + 1
    
    def _cleanup_old_entries(self, fingerprint: str, current_date: str, current_hour: str):
        """Remove old entries to prevent memory leak"""
        # Keep only current day
        if fingerprint in self.daily_counts:
            self.daily_counts[fingerprint] = {
                k: v for k, v in self.daily_counts[fingerprint].items() 
                if k == current_date
            }
        
        # Keep only current hour
        if fingerprint in self.hourly_counts:
            self.hourly_counts[fingerprint] = {
                k: v for k, v in self.hourly_counts[fingerprint].items() 
                if k == current_hour
            }
    
    def get_usage_stats(self, fingerprint: str) -> Dict[str, int]:
        """Get current usage statistics for a fingerprint"""
        date_key = self._get_date_key()
        hour_key = self._get_hour_key()
        
        return {
            "daily_count": self.daily_counts[fingerprint].get(date_key, 0),
            "daily_limit": self.requests_per_day,
            "hourly_count": self.hourly_counts[fingerprint].get(hour_key, 0),
            "hourly_limit": self.requests_per_hour,
            "daily_remaining": self.requests_per_day - self.daily_counts[fingerprint].get(date_key, 0),
            "hourly_remaining": self.requests_per_hour - self.hourly_counts[fingerprint].get(hour_key, 0)
        }

# Global rate limiter instance
rate_limiter = RateLimiter(
    requests_per_day=int(os.getenv("DAILY_REQUEST_LIMIT", "50")),
    requests_per_hour=int(os.getenv("HOURLY_REQUEST_LIMIT", "10"))
)
