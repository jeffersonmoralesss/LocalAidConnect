# LocalAid Connect
## Software Requirements Specification (SRS)

**Version:** MVP 1.0  
**Author:** Jefferson Morales  
**Project Type:** Web-first application with AI-guided search  
**Status:** Active – MVP build phase  

---

## 1. Introduction

### 1.1 Purpose
This document defines the functional and non-functional requirements for **LocalAid Connect**, a web-first platform that helps users locate nearby organizations providing essential services (food banks, shelters, clinics, vaccines, etc.) using an AI-guided natural-language search interface.

This SRS is the **authoritative source of truth** for all implementation decisions.  
All generated code must conform strictly to the requirements defined herein.

---

### 1.2 Scope (MVP)

#### In Scope
- AI-guided search (natural language → structured query)
- Location-based organization search
- Results display (list-first, optional map)
- Organization detail pages
- Report incorrect information flow
- Admin moderation interface

#### Out of Scope
- User authentication & profiles
- Real-time shelter or bed availability
- Medical or legal advice
- Donations or payments
- Messaging/chat systems
- Push notifications
- Organization self-service portals

---

### 1.3 Definitions and Abbreviations

| Term | Definition |
|---|---|
| Organization | A provider of services (food bank, shelter, clinic, etc.) |
| Service | A specific offering provided by an organization |
| AI Parse | AI-assisted conversion of natural language into a strict JSON query |
| MVP | Minimum Viable Product |
| Admin | Authorized moderator responsible for data quality |

---

## 2. Overall System Description

### 2.1 Product Perspective
LocalAid Connect consists of:
- A **React web client** (mobile-first)
- A **Node.js + Express backend API**
- An **AI parsing component (LLM)**
- A **SQLite database** (migration path to Postgres)

The AI component **never returns results directly**.  
It only outputs validated query parameters used by backend search logic.

---

### 2.2 User Classes

| User | Description |
|---|---|
| Help Seeker | Primary user seeking assistance |
| Volunteer | Secondary user looking to help |
| Admin | Reviews reports and maintains data |

---

### 2.3 Operating Environment
- Browsers: Chrome, Safari, Firefox (latest)
- Responsive mobile-first UI
- Backend runtime: Node.js
- Database: SQLite (MVP)

---

## 3. Functional Requirements

---

## 3.1 AI-Guided Search (Core Feature)

### Description
Users enter a natural-language description of their need.  
The system converts it into a **strictly validated JSON query**, which is then executed against the database.

---

### Requirements

**REQ-3.1.1**  
The system SHALL provide a single text input for users to describe needs in natural language.

**REQ-3.1.2**  
The AI parser SHALL output results using a strict JSON schema.

**REQ-3.1.3**  
The AI parser SHALL NOT invent organizations or claim real-time availability.

**REQ-3.1.4**  
The AI parser SHALL NOT provide medical, legal, or emergency advice.

**REQ-3.1.5**  
If AI parsing or schema validation fails, the system SHALL fall back to keyword-based search.

**REQ-3.1.6**  
All AI outputs SHALL be validated server-side before execution.

---

### AI Output Schema (MVP)

```json
{
  "category": "food | shelter | medical | vaccines | mental_health | legal | other",
  "urgency": "now | today | this_week",
  "radiusMiles": 3,
  "filters": {
    "openNow": true,
    "walkIn": false,
    "costFree": true,
    "noId": false
  }
}

---

## 3.2 Organization Search & Results

**REQ-3.2.1**  
The system SHALL return organizations within a configurable radius.

**REQ-3.2.2**  
Results SHALL be sortable by distance (nearest first).

**REQ-3.2.3**  
The system SHALL support filtering by service category.

**REQ-3.2.4**  
The system SHALL support an “open now” filter (best-effort).

**REQ-3.2.5**  
List view SHALL be the default display mode.

---

## 3.3 Organization Detail Page

**REQ-3.3.1**  
Each organization SHALL have a dedicated detail page.

**REQ-3.3.2**  
The detail page SHALL display:
- Name
- Address
- Phone
- Website (if available)
- Services offered
- Operating hours
- Last verified timestamp

**REQ-3.3.3**  
One-click actions SHALL be provided for calling and directions.

---

## 3.4 Report Issue Flow

**REQ-3.4.1**  
Users SHALL be able to report incorrect organization information.

**REQ-3.4.2**  
Report types SHALL include:
- Incorrect hours
- Moved location
- Closed permanently
- Incorrect services

**REQ-3.4.3**  
Each report SHALL have a status:
- NEW
- UNDER_REVIEW
- APPLIED
- REJECTED

---

## 3.5 Admin Moderation

**REQ-3.5.1**  
Admins SHALL be able to view all reports.

**REQ-3.5.2**  
Admins SHALL be able to update organization data.

**REQ-3.5.3**  
Admins SHALL be able to mark reports as APPLIED or REJECTED.

---

## 4. Data Model (MVP)

### 4.1 Organization

**REQ-4.1.1**  
The system SHALL store organizations with a unique identifier.

**REQ-4.1.2**  
An Organization SHALL include:
- name
- address
- latitude
- longitude
- phone number
- website (optional)
- verification status
- last verified timestamp

---

### 4.2 Service

**REQ-4.2.1**  
Each Organization SHALL have one or more Services.

**REQ-4.2.2**  
A Service SHALL include:
- service type
- eligibility description
- cost indicator
- walk-in indicator
- ID requirement indicator

---

### 4.3 Hours

**REQ-4.3.1**  
An Organization MAY have multiple Hours entries.

**REQ-4.3.2**  
Hours entries SHALL specify:
- day of week
- open time
- close time
- closed indicator

---

### 4.4 Report

**REQ-4.4.1**  
Users SHALL be able to submit Reports associated with an Organization.

**REQ-4.4.2**  
A Report SHALL include:
- report type
- message
- status
- creation timestamp

---

## 5. Non-Functional Requirements

**REQ-5.1**  
Search results SHOULD return within 2 seconds.

**REQ-5.2**  
The UI SHALL be keyboard accessible and screen-reader compatible.

**REQ-5.3**  
Users SHALL NOT be required to create accounts.

**REQ-5.4**  
AI and report endpoints SHALL be rate-limited.

**REQ-5.5**  
The system SHALL handle errors gracefully.

---

## 6. MVP Constraints
- No real-time availability guarantees
- No medical or legal advice
- No automated AI publishing
- No user authentication (except admin)

---

## 7. Future Enhancements
- Organization self-service portal
- Multilingual UI
- Data ingestion pipelines
- Favorites and saved searches
- Mobile app wrapper

---

## 8. Cursor Execution Rules

**REQ-8.1**  
This document SHALL be treated as authoritative.

**REQ-8.2**  
Cursor SHALL NOT implement features outside MVP scope.

**REQ-8.3**  
Requirement IDs SHALL be referenced in code and commits when practical.

---

## End of Software Requirements Specification