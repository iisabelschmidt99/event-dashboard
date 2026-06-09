# FENYX Event-Dashboard — Deployment-Anleitung

## Projektstruktur

```
fenyx-events-dashboard/
├── index.html                    ← Das Dashboard
├── netlify.toml                  ← Netlify-Konfiguration
└── netlify/
    └── functions/
        └── hubspot.js            ← HubSpot API Proxy (serverseitig)
```

## 1. GitHub Repository anlegen

```bash
git init
git add .
git commit -m "Initial commit: FENYX Event-Dashboard"
git remote add origin https://github.com/DEIN-ACCOUNT/fenyx-events-dashboard.git
git push -u origin main
```

## 2. Netlify verbinden

1. netlify.com → **Add new site** → **Import an existing project**
2. GitHub-Repo auswählen
3. Build-Einstellungen: alles leer lassen (kein Build-Command nötig)
4. **Deploy site**

## 3. HubSpot Token als Umgebungsvariable setzen

In Netlify → **Site settings → Environment variables → Add variable:**

| Key | Value |
|-----|-------|
| `HUBSPOT_TOKEN` | `pat-eu1-XXXXXXXX` |

Danach: **Trigger deploy** (einmalig neu deployen).

## 4. Lokal testen (optional)

```bash
npm install -g netlify-cli
netlify dev
```
Öffne http://localhost:8888 — die HubSpot-Funktion läuft dann lokal.

## HubSpot API-Endpunkte (Übersicht)

| Action | Endpunkt |
|--------|---------|
| `events` | `/crm/v3/objects/marketing_events` |
| `contacts` | `/crm/v3/objects/contacts` |
| `deals` | `/crm/v3/objects/deals` |
| `attendees` | `/marketing/v3/marketing-events/{id}/attendees` |

## Nächste Schritte: Event-spezifische Kontakte

Um Kontakte direkt einem Event zuzuordnen, gibt es zwei Optionen:

**Option A** (empfohlen): HubSpot Marketing Event Attendance API nutzen  
→ Kontakte über das HubSpot-Anmeldeformular registrieren, dann liefert  
`/marketing/v3/marketing-events/{id}/attendees` die Event-spezifischen Teilnehmer.

**Option B**: Custom Property auf Deals/Kontakten anlegen  
→ In HubSpot ein Feld `event_po_number` erstellen und bei jeder Anmeldung befüllen  
→ Dashboard filtert dann nach PO-Nummer.
