from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import enum

DATABASE_URL = "sqlite:///./team.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class RoleEnum(str, enum.Enum):
    developer   = "Developer"
    designer    = "Designer"
    manager     = "Manager"
    qa          = "QA Engineer"
    devops      = "DevOps"
    analyst     = "Analyst"


class TeamMember(Base):
    __tablename__ = "team_members"

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String(100), nullable=False)
    role         = Column(String(50), default="Developer")
    department   = Column(String(100), default="Engineering")
    avatar_color = Column(String(7), default="#6366f1")   # hex color for initials avatar
    is_available = Column(Boolean, default=True)
    status_note  = Column(String(200), default="")        # e.g. "In a meeting", "On leave"
    timezone     = Column(String(50), default="UTC")
    joined_at    = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
    # Seed with sample team members if empty
    db = SessionLocal()
    if db.query(TeamMember).count() == 0:
        seed_members = [
            TeamMember(name="Alex Rivera",    role="Engineering Lead", department="Engineering",   avatar_color="#8b5cf6", is_available=True,  status_note="",                 timezone="UTC-8"),
            TeamMember(name="Priya Sharma",   role="Designer",        department="Product",        avatar_color="#ec4899", is_available=True,  status_note="",                 timezone="UTC+5:30"),
            TeamMember(name="Jordan Lee",     role="Backend Dev",     department="Engineering",    avatar_color="#06b6d4", is_available=False, status_note="In a meeting",     timezone="UTC-5"),
            TeamMember(name="Sam Chen",       role="DevOps",          department="Infrastructure", avatar_color="#10b981", is_available=True,  status_note="",                 timezone="UTC+8"),
            TeamMember(name="Maya Patel",     role="QA Engineer",     department="Quality",        avatar_color="#f59e0b", is_available=False, status_note="On leave until Mon",timezone="UTC+5:30"),
            TeamMember(name="Chris Wilson",   role="Product Manager", department="Product",        avatar_color="#ef4444", is_available=True,  status_note="",                 timezone="UTC-5"),
            TeamMember(name="Yuki Tanaka",    role="Frontend Dev",    department="Engineering",    avatar_color="#6366f1", is_available=True,  status_note="",                 timezone="UTC+9"),
            TeamMember(name="Omar Hassan",    role="Data Analyst",    department="Analytics",      avatar_color="#84cc16", is_available=False, status_note="Focus time",       timezone="UTC+3"),
        ]
        db.add_all(seed_members)
        db.commit()
    db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
