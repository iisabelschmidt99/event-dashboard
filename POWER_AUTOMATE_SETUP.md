# Power Automate Flow: Rechnung an Finance

Dieser Flow empfängt eine hochgeladene Rechnung vom Dashboard (über die Netlify-Function
`notify.js`) und sendet automatisch eine E-Mail an **finance@fenyx-office.com** mit dem
PDF als Anhang.

Ablauf: Dashboard → `notify.js` → **HTTP-Webhook (dieser Flow)** → E-Mail an Finance.

---

## Was die Function sendet

`notify.js` schickt per `POST` folgendes JSON an den Webhook:

```json
{
  "to": "finance@fenyx-office.com",
  "subject": "Rechnung",
  "filename": "rechnung.pdf",
  "contentBytes": "JVBERi0xLjQK...(Base64 des PDFs)",
  "anbieter": "Balci & Gastronomie Hafen GmbH",
  "betrag": 2975,
  "kategorie": "location",
  "status": "beauftragt",
  "po": "PO-12345",
  "event": "Architekten",
  "eventId": "1229695179966",
  "bodyHtml": "<div>...formatierter HTML-Mailtext...</div>",
  "bodyText": "Hallo Buchhaltung, ...(Klartext-Variante)"
}
```

Wichtig:
- `contentBytes` ist das **Base64** des PDFs (wird von `notify.js` serverseitig aus
  dem Storage geholt und ist immer befüllt). Im Mail-Anhang muss es mit
  `base64ToBinary(...)` in Binärdaten zurückgewandelt werden (Schritt 3).
- `bodyHtml` ist der **schön formatierte** Mailtext (HTML) — den ins Body-Feld setzen.

---

## Schritt 1 — Flow anlegen

1. In **Power Automate** (make.powerautomate.com) → **Erstellen** → **Sofortiger Cloud-Flow**
   (Instant cloud flow).
2. Namen vergeben, z. B. `Dashboard – Rechnung an Finance`.
3. Als Auslöser **„Wenn eine HTTP-Anforderung empfangen wird"**
   („When a HTTP request is received") wählen → **Erstellen**.

> Die Webhook-URL wird erst nach dem **ersten Speichern** generiert.

---

## Schritt 2 — HTTP-Trigger konfigurieren

1. Im Trigger auf **„Beispielnutzlast zum Generieren des Schemas verwenden"**
   („Use sample payload to generate schema") klicken.
2. Folgendes einfügen und mit **Fertig** bestätigen — damit stehen alle Felder als
   dynamischer Inhalt zur Verfügung:

```json
{
  "to": "finance@fenyx-office.com",
  "subject": "Rechnung",
  "filename": "rechnung.pdf",
  "contentBytes": "JVBERi0x",
  "anbieter": "Beispiel GmbH",
  "betrag": 2975,
  "kategorie": "location",
  "status": "beauftragt",
  "po": "PO-12345",
  "event": "Architekten",
  "eventId": "1229695179966",
  "bodyHtml": "<div>Beispiel</div>",
  "bodyText": "Neue Rechnung hochgeladen."
}
```

3. (Optional, empfohlen) Methode auf **POST** einschränken: Trigger → **…** →
   **Einstellungen** ist nicht nötig; stattdessen im Trigger unter „Erweiterte
   Optionen anzeigen" **Method = POST** setzen.

---

## Schritt 3 — E-Mail senden

1. **Neuer Schritt** → Connector **Office 365 Outlook** → Aktion
   **„E-Mail senden (V2)"** („Send an email (V2)").
2. Felder befüllen (rechts über „Dynamischer Inhalt" die Trigger-Felder einsetzen):

   | Feld          | Wert                                                            |
   |---------------|-----------------------------------------------------------------|
   | **An (To)**   | `finance@fenyx-office.com` (oder dynamisch das Feld `to`)        |
   | **Betreff**   | das dynamische Feld `subject`  → ergibt „Rechnung"               |
   | **Textkörper**| das dynamische Feld **`bodyHtml`** (schön formatiert; „Is HTML" bleibt Ja) |

3. Unten **„Erweiterte Optionen anzeigen"** → Bereich **Anlagen (Attachments)**:

   | Feld                          | Wert                                                  |
   |-------------------------------|-------------------------------------------------------|
   | **Anlagenname – 1**           | das dynamische Feld `filename`                        |
   | **Anlageninhalt – 1**         | Ausdruck: `base64ToBinary(triggerBody()?['contentBytes'])` |

   > Der **Anlageninhalt** muss als **Ausdruck (Expression)** eingegeben werden,
   > nicht als dynamischer Inhalt. Reiter „Ausdruck/Expression" wählen, einfügen, **OK**.

4. **Speichern.**

---

## Schritt 4 — Webhook-URL in Netlify hinterlegen

1. Nach dem Speichern den **HTTP-Trigger** wieder öffnen → die generierte
   **„HTTP-POST-URL"** kopieren (enthält bereits einen geheimen Signatur-Token).
2. In **Netlify** → Site → **Site configuration** → **Environment variables** →
   neue Variable anlegen:

   ```
   POWER_AUTOMATE_URL = <die kopierte HTTP-POST-URL>
   ```

3. **Redeploy** auslösen (Deploys → Trigger deploy), damit die Variable greift.

> Die URL ist ein Geheimnis (jeder mit der URL kann den Flow auslösen). Nur in
> Netlify-Env speichern, **nicht** ins Git-Repo committen.

---

## Schritt 5 — Test

1. Im Dashboard unter **Kosten → Rechnung hochladen** ein Test-PDF hochladen.
2. Erwartung:
   - Bestätigung „Rechnung gespeichert … E-Mail an Finance gesendet."
   - E-Mail bei finance@fenyx-office.com mit Betreff **Rechnung** und PDF-Anhang.
3. In Power Automate unter **Meine Flows → <Flow> → Verlauf (Run history)** siehst du
   jeden Aufruf und kannst bei Fehlern die Eingaben/Ausgaben prüfen.

---

## Absenderadresse (optional)

„E-Mail senden (V2)" verschickt standardmäßig **vom verbundenen Konto** (das, mit dem
der Outlook-Connector autorisiert wurde). Soll explizit aus einem **freigegebenen
Postfach** (z. B. dashboard@fenyx-office.com) gesendet werden:

- In „Erweiterte Optionen" das Feld **„Von (Senden als)"** („From (Send as)") setzen.
- Das verbundene Konto braucht dafür **Senden-als-Rechte** auf dieses Postfach.

---

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Upload meldet „E-Mail noch nicht aktiv: POWER_AUTOMATE_URL …" | Variable in Netlify fehlt oder kein Redeploy. |
| „Power Automate Fehler: …" im Dashboard | Flow-Run-Verlauf prüfen; meist Schema- oder Attachment-Ausdruck. |
| Anhang ist leer/defekt | `Anlageninhalt` muss `base64ToBinary(triggerBody()?['contentBytes'])` sein. |
| Mail kommt nicht an | Spam prüfen; Absenderkonto/Senden-als-Rechte prüfen. |
| Große PDFs scheitern | Upload-Limit ist 4 MB (Netlify-Body-Limit). |
