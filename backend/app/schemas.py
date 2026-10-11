"""Lane 0 models aligned with contracts/openapi.yaml. Coordinate order is deliberate."""
from datetime import datetime, timezone, timedelta
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, model_validator
from shapely.geometry import shape

Lat = Annotated[float, Field(ge=-90, le=90, strict=True)]
Lon = Annotated[float, Field(ge=-180, le=180, strict=True)]
Nonnegative = Annotated[float, Field(ge=0, strict=True)]
Count = Annotated[int, Field(ge=0, strict=True)]

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

class Coordinate(Model):
    lat: Lat
    lon: Lon

class ManualReport(Coordinate):
    id: UUID
    kind: Literal['pothole', 'obstruction', 'closure', 'other']
    observed_at: AwareDatetime
    description: Annotated[str, Field(max_length=280)] = ''

    @model_validator(mode='after')
    def future(self):
        if self.observed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValueError('observed_at exceeds now + five minutes')
        return self

class Polygon(Model):
    type: Literal['Polygon']
    coordinates: Annotated[list[Annotated[list[tuple[Lon, Lat]], Field(min_length=4)]], Field(min_length=1)]

    @model_validator(mode='after')
    def valid_polygon(self):
        if any(ring[0] != ring[-1] for ring in self.coordinates):
            raise ValueError('polygon rings must be closed')
        polygon = shape(self.model_dump())
        if polygon.is_empty or not polygon.is_valid or polygon.area == 0:
            raise ValueError('polygon must be valid and nonempty')
        return self

class AutomaticPublication(Model):
    revision: Annotated[int, Field(ge=1, strict=True)]
    kind: Literal['braking', 'surface', 'abandoned']
    geometry: Polygon
    score: Annotated[float, Field(ge=0, le=1, strict=True)]
    event_count: Count
    ride_count: Count
    first_seen: AwareDatetime
    last_seen: AwareDatetime
    expires_at: AwareDatetime
    status: Literal['active', 'resolved']
    label: str
    evidence_source: Literal['device', 'simulated', 'replay', 'mixed']

    @model_validator(mode='after')
    def ordered(self):
        if not self.first_seen <= self.last_seen <= self.expires_at:
            raise ValueError('require first_seen <= last_seen <= expires_at')
        return self

class Place(Model):
    id: Annotated[str, Field(max_length=64)]
    name: Annotated[str, Field(max_length=120)]
    address: Annotated[str, Field(max_length=200)]
    lat: Lat
    lon: Lon

class PlaceResults(Model):
    places: Annotated[list[Place], Field(max_length=5)]

class ReportReceipt(Model):
    report_id: UUID
    hazard_id: UUID
    duplicate: bool

class HazardFeedback(Model):
    id: UUID
    response: Literal['still_there', 'gone']

class FeedbackReceipt(Model):
    feedback_id: UUID
    hazard_id: UUID
    duplicate: bool

class PublicationReceipt(Model):
    hazard_id: UUID
    revision: int
    duplicate: bool

class HazardProperties(Model):
    id: UUID
    source: Literal['manual', 'automatic']
    kind: Literal['pothole', 'obstruction', 'closure', 'other', 'braking', 'surface', 'abandoned']
    label: str
    score: Annotated[float, Field(ge=0, le=1, strict=True)]
    status: Literal['active', 'resolved']
    first_seen: AwareDatetime
    last_seen: AwareDatetime
    expires_at: AwareDatetime
    event_count: Count
    ride_count: Count
    report_count: Count
    evidence_source: Literal['device', 'simulated', 'replay', 'mixed'] | None

class HazardFeature(Model):
    type: Literal['Feature']
    geometry: Polygon
    properties: HazardProperties

class HazardCollection(Model):
    type: Literal['FeatureCollection']
    features: list[HazardFeature]

class LineString(Model):
    type: Literal['LineString']
    coordinates: Annotated[list[tuple[Lon, Lat]], Field(min_length=2)]

class RouteRequest(Model):
    origin: Coordinate
    destination: Coordinate

class Route(Model):
    kind: Literal['shortest', 'safest']
    geometry: LineString
    distance_m: Nonnegative
    duration_s: Nonnegative
    risk_score: Annotated[float, Field(ge=0, le=1, strict=True)]
    hazard_ids: list[UUID]

class AlternativeRoute(Route):
    kind: Literal['alternative']

class RouteResponse(Model):
    routes: Annotated[list[Route], Field(min_length=2, max_length=2)]
    safest_available: bool
    alternatives: Annotated[list[AlternativeRoute], Field(max_length=2)] = []

class AIStatus(Model):
    available: bool

class PhotoAnalysisRequest(Model):
    # JPEG bytes only, never remote URLs or precise location metadata.
    image_base64: Annotated[str, Field(min_length=4, max_length=4194304)]

class PhotoAnalysis(Model):
    status: Literal['suggested', 'unclear', 'no_hazard']
    kind: Literal['pothole', 'obstruction', 'closure', 'other'] | None
    description: Annotated[str, Field(min_length=1, max_length=280)]

    @model_validator(mode='after')
    def coherent(self):
        if (self.status == 'suggested') != (self.kind is not None):
            raise ValueError('Only a suggested hazard can have a category')
        if not self.description.strip() or any(ord(c) < 32 for c in self.description):
            raise ValueError('Description must be readable plain text')
        return self

class AIRouteSummary(Model):
    kind: Literal['shortest', 'safest']
    distance_m: Annotated[float, Field(ge=0, le=10000000, strict=True)]
    duration_s: Annotated[float, Field(ge=0, le=1000000, strict=True)]
    hazard_count: Annotated[int, Field(ge=0, le=10000, strict=True)]

class RouteExplanationRequest(Model):
    routes: Annotated[list[AIRouteSummary], Field(min_length=2, max_length=2)]
    safest_available: bool

    @model_validator(mode='after')
    def distinct_kinds(self):
        if {route.kind for route in self.routes} != {'shortest', 'safest'}:
            raise ValueError('Provide one baseline and one lower-risk route')
        return self

class RouteExplanation(Model):
    explanation: Annotated[str, Field(min_length=1, max_length=700)]
