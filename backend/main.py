from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

try:
    from .database import get_db, init_db, TeamMember
except ImportError:
    from database import get_db, init_db, TeamMember

init_db()

app = FastAPI(title="Team Availability Tracker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class MemberOut(BaseModel):
    id:           int
    name:         str
    role:         str
    department:   str
    avatar_color: str
    is_available: bool
    status_note:  str
    timezone:     str
    joined_at:    datetime
    updated_at:   datetime

    class Config:
        from_attributes = True


class MemberCreate(BaseModel):
    name:         str  = Field(..., min_length=1, max_length=100)
    role:         str  = Field("Developer", max_length=50)
    department:   str  = Field("Engineering", max_length=100)
    avatar_color: str  = Field("#6366f1")
    is_available: bool = True
    status_note:  str  = Field("", max_length=200)
    timezone:     str  = Field("UTC", max_length=50)


class AvailabilityUpdate(BaseModel):
    is_available: bool
    status_note:  Optional[str] = Field(None, max_length=200)


class MemberUpdate(BaseModel):
    name:         Optional[str] = Field(None, min_length=1, max_length=100)
    role:         Optional[str] = Field(None, max_length=50)
    department:   Optional[str] = Field(None, max_length=100)
    avatar_color: Optional[str] = None
    is_available: Optional[bool] = None
    status_note:  Optional[str] = Field(None, max_length=200)
    timezone:     Optional[str] = Field(None, max_length=50)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Team Availability Tracker API. Docs at /docs"}


@app.get("/api/members", response_model=List[MemberOut])
def get_members(db: Session = Depends(get_db)):
    """Return all team members sorted: available first, then alphabetically."""
    return (
        db.query(TeamMember)
        .order_by(TeamMember.is_available.desc(), TeamMember.name)
        .all()
    )


@app.post("/api/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def add_member(data: MemberCreate, db: Session = Depends(get_db)):
    """Add a new team member."""
    member = TeamMember(**data.dict())
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@app.patch("/api/members/{member_id}/availability", response_model=MemberOut)
def toggle_availability(member_id: int, body: AvailabilityUpdate, db: Session = Depends(get_db)):
    """
    Core endpoint: update the is_available boolean for a member.
    Optionally update the status note at the same time.
    This is the key state-sync operation that updates DB and returns
    the updated record for the frontend to re-render.
    """
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    member.is_available = body.is_available
    if body.status_note is not None:
        member.status_note = body.status_note
    elif body.is_available:
        member.status_note = ""       # clear status when going available

    member.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(member)
    return member


@app.patch("/api/members/{member_id}", response_model=MemberOut)
def update_member(member_id: int, data: MemberUpdate, db: Session = Depends(get_db)):
    """Full partial-update of a member's profile."""
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    for field, value in data.dict(exclude_unset=True).items():
        setattr(member, field, value)
    member.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(member)
    return member


@app.delete("/api/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    """Remove a team member."""
    member = db.query(TeamMember).filter(TeamMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
    return None


@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    """Dashboard summary stats."""
    total     = db.query(TeamMember).count()
    available = db.query(TeamMember).filter(TeamMember.is_available == True).count()
    busy      = total - available

    # department breakdown
    from sqlalchemy import func
    dept_rows = (
        db.query(TeamMember.department, func.count(TeamMember.id))
        .group_by(TeamMember.department)
        .all()
    )
    departments = {row[0]: row[1] for row in dept_rows}

    return {
        "total":       total,
        "available":   available,
        "unavailable": busy,
        "availability_rate": round((available / total * 100) if total else 0, 1),
        "departments": departments,
    }
