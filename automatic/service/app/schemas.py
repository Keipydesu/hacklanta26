"""Independent observation models; no product app imports."""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, model_validator

Nonnegative = Annotated[float, Field(ge=0, strict=True)]
class Observation(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: UUID
    ts: AwareDatetime
    lat: Annotated[float, Field(ge=-90, le=90, strict=True)]
    lon: Annotated[float, Field(ge=-180, le=180, strict=True)]
    accuracy_m: Nonnegative
    source: Literal['device', 'simulated', 'replay']

    @model_validator(mode='after')
    def future(self):
        if self.ts > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('timestamp exceeds now + five minutes')
        return self

class ObservationEvent(Observation):
    ride_id: UUID
    type: Literal['hard_brake', 'bump']
    speed_before_mps: Nonnegative
    speed_after_mps: Nonnegative
    peak_g: Nonnegative
    duration_ms: Annotated[int, Field(ge=0, strict=True)]

class ObservationPoint(Observation):
    speed_mps: Nonnegative

class EventBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    events: Annotated[list[ObservationEvent], Field(max_length=500)]

class PointBatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    points: Annotated[list[ObservationPoint], Field(max_length=2000)]

class IngestReceipt(BaseModel):
    accepted: int
    duplicates: int
