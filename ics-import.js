#!/usr/bin/env node

const ICAL = require("ical.js");
const { google } = require("googleapis");
const fs = require("fs");
const readline = require("readline");

const CREDENTIALS_FILE = "credentials.json";
const EMAIL_ALIASES_FILE = "data/email_aliases.json";
const NAME_TO_EMAIL_FILE = "data/name_to_email.json";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class CalendarImporter {
  constructor() {
    this.ensureDataDirectory();
    this.emailAliases = this.loadEmailAliases();
    this.nameToEmail = this.loadNameToEmail();
    // Default values, will be overridden by command line options
    this.checkDuplicates = false;
    this.skipErrors = false;
  }

  ensureDataDirectory() {
    try {
      if (!fs.existsSync("data")) {
        fs.mkdirSync("data", { recursive: true });
        console.log("📁 Created data directory");
      }
    } catch (error) {
      console.error("⚠️  Could not create data directory:", error.message);
    }
  }

  loadEmailAliases() {
    try {
      if (fs.existsSync(EMAIL_ALIASES_FILE)) {
        const aliases = JSON.parse(fs.readFileSync(EMAIL_ALIASES_FILE, "utf8"));
        console.log(`✅ Loaded ${Object.keys(aliases).length} email aliases`);
        return aliases;
      }
    } catch (error) {
      console.log("⚠️  Could not load email aliases, starting fresh");
    }
    return {};
  }

  loadNameToEmail() {
    try {
      if (fs.existsSync(NAME_TO_EMAIL_FILE)) {
        const mappings = JSON.parse(fs.readFileSync(NAME_TO_EMAIL_FILE, "utf8"));
        console.log(`✅ Loaded ${Object.keys(mappings).length} name-to-email mappings`);
        return mappings;
      }
    } catch (error) {
      console.log("⚠️  Could not load name-to-email mappings, starting fresh");
    }
    return {};
  }

  saveEmailAliases() {
    try {
      // Sort for consistent diff-friendly output
      const sortedAliases = Object.keys(this.emailAliases)
        .sort()
        .reduce((obj, key) => {
          obj[key] = this.emailAliases[key];
          return obj;
        }, {});

      fs.writeFileSync(EMAIL_ALIASES_FILE, JSON.stringify(sortedAliases, null, 2));
      console.log(
        `💾 Saved ${Object.keys(sortedAliases).length} email aliases to ${EMAIL_ALIASES_FILE}`,
      );
    } catch (error) {
      console.error("❌ Failed to save email aliases:", error.message);
    }
  }

  saveNameToEmail() {
    try {
      // Sort for consistent diff-friendly output
      const sortedMappings = Object.keys(this.nameToEmail)
        .sort()
        .reduce((obj, key) => {
          obj[key] = this.nameToEmail[key];
          return obj;
        }, {});

      fs.writeFileSync(NAME_TO_EMAIL_FILE, JSON.stringify(sortedMappings, null, 2));
      console.log(
        `💾 Saved ${Object.keys(sortedMappings).length} name-to-email mappings to ${NAME_TO_EMAIL_FILE}`,
      );
    } catch (error) {
      console.error("❌ Failed to save name-to-email mappings:", error.message);
    }
  }

  async promptForEmailAlias(originalEmail) {
    console.log(`\n📧 EMAIL ALIAS REQUIRED`);
    console.log(`Original: "${originalEmail}"`);
    console.log("This email may be invalid. Please provide a valid email address.");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const askForEmail = () => {
        rl.question(`Enter valid email for "${originalEmail}": `, (email) => {
          if (!email.trim()) {
            console.log("❌ Email cannot be empty");
            askForEmail();
            return;
          }

          if (EMAIL_REGEX.test(email.trim())) {
            rl.close();
            resolve(email.trim());
          } else {
            console.log("❌ Invalid email format, please try again");
            askForEmail();
          }
        });
      };
      askForEmail();
    });
  }

  async promptForNameEmail(name) {
    console.log(`\n👤 NAME-TO-EMAIL MAPPING REQUIRED`);
    console.log(`Name: "${name}"`);
    console.log("This person has no email address. Please provide one.");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const askForEmail = () => {
        rl.question(`Enter email address for "${name}": `, (email) => {
          if (!email.trim()) {
            console.log("❌ Email cannot be empty");
            askForEmail();
            return;
          }

          if (EMAIL_REGEX.test(email.trim())) {
            rl.close();
            resolve(email.trim());
          } else {
            console.log("❌ Invalid email format, please try again");
            askForEmail();
          }
        });
      };
      askForEmail();
    });
  }

  extractEmail(emailData) {
    if (!emailData) return null;

    let email = "";

    if (typeof emailData === "string") {
      email = emailData;
    } else if (emailData.getFirstValue) {
      email = emailData.getFirstValue();
    } else {
      return null;
    }

    // Some ICS files include mailto: prefix
    email = email.replace(/^mailto:/i, "").trim();

    return email || null;
  }

  async extractAllEmailsAndNames(icsFilePath) {
    console.log(`\n🔍 Scanning ICS file for emails and names: ${icsFilePath}`);

    const icsData = fs.readFileSync(icsFilePath, "utf8");
    const jcalData = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const foundEmails = new Set();
    const foundNames = new Set();
    let eventCount = 0;

    for (const vevent of vevents) {
      eventCount++;
      const event = new ICAL.Event(vevent);

      const organizerProp = event.component.getFirstProperty("organizer");
      if (organizerProp) {
        const organizerEmail = this.extractEmail(organizerProp.getFirstValue());
        const organizerName = organizerProp.getParameter("cn");

        if (organizerEmail) {
          foundEmails.add(organizerEmail);
        } else if (organizerName) {
          foundNames.add(organizerName);
        }
      }

      const attendeeProps = event.component.getAllProperties("attendee");
      if (attendeeProps) {
        for (const attendeeProp of attendeeProps) {
          const attendeeEmail = this.extractEmail(attendeeProp.getFirstValue());
          const attendeeName = attendeeProp.getParameter("cn");

          if (attendeeEmail) {
            foundEmails.add(attendeeEmail);
          } else if (attendeeName) {
            foundNames.add(attendeeName);
          }
        }
      }
    }

    console.log(`📊 Scanned ${eventCount} events`);
    console.log(`   📧 Found ${foundEmails.size} unique emails`);
    console.log(`   👤 Found ${foundNames.size} unique names (no email)`);

    return {
      emails: Array.from(foundEmails),
      names: Array.from(foundNames),
    };
  }

  isValidEmail(email) {
    return EMAIL_REGEX.test(email);
  }

  async prepareEmails(icsFilePath) {
    try {
      console.log("🚀 PREPARE MODE: Building email and name mappings\n");

      const { emails, names } = await this.extractAllEmailsAndNames(icsFilePath);

      if (emails.length === 0 && names.length === 0) {
        console.log("✅ No emails or names found in ICS file");
        return;
      }

      let newEmailMappings = 0;
      let newNameMappings = 0;
      let emailPrompts = 0;
      let namePrompts = 0;

      console.log("\n📧 Processing emails...");
      for (const email of emails) {
        if (this.emailAliases[email]) {
          console.log(`✓ ${email} → ${this.emailAliases[email]} (existing)`);
          continue;
        }

        if (this.isValidEmail(email)) {
          this.emailAliases[email] = email;
          console.log(`✓ ${email} → ${email} (valid)`);
          newEmailMappings++;
        } else {
          console.log(`❌ Invalid email found: "${email}"`);
          const validEmail = await this.promptForEmailAlias(email);
          this.emailAliases[email] = validEmail;
          console.log(`✅ Mapped: ${email} → ${validEmail}`);
          newEmailMappings++;
          emailPrompts++;
        }
      }

      if (names.length > 0) {
        console.log("\n👤 Processing names without emails...");
        for (const name of names) {
          if (this.nameToEmail[name]) {
            console.log(`✓ ${name} → ${this.nameToEmail[name]} (existing)`);
            continue;
          }

          const email = await this.promptForNameEmail(name);
          this.nameToEmail[name] = email;
          console.log(`✅ Mapped: ${name} → ${email}`);
          newNameMappings++;
          namePrompts++;
        }
      }

      if (newEmailMappings > 0) {
        this.saveEmailAliases();
      }
      if (newNameMappings > 0) {
        this.saveNameToEmail();
      }

      // Generate JSONL file with all converted events
      await this.generateEventsJSON(icsFilePath);

      console.log(`\n🎉 Email preparation complete!`);
      console.log(
        `   📧 ${emails.length} emails processed (${newEmailMappings} new mappings, ${emailPrompts} prompted)`,
      );
      console.log(
        `   👤 ${names.length} names processed (${newNameMappings} new mappings, ${namePrompts} prompted)`,
      );
      console.log(`\n💡 Now run: node script.js process ${icsFilePath}`);
    } catch (error) {
      console.error("❌ Prepare failed:", error.message);
      process.exit(1);
    }
  }

  async generateEventsJSON(icsFilePath) {
    console.log(`\n📄 Generating events JSON from ICS file...`);

    const icsData = fs.readFileSync(icsFilePath, "utf8");
    const jcalData = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const jsonlPath = `${icsFilePath}.jsonl`;
    const events = [];
    let skippedCount = 0;

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const googleEvent = this.convertICSToGoogleEvent(event);

      if (!googleEvent) {
        skippedCount++;
        continue;
      }

      const eventData = {
        ...googleEvent,
        _metadata: {
          isRecurrenceException: !!googleEvent._isRecurrenceException,
          hasRecurrence: !!googleEvent.recurrence,
          originalICalUID: event.uid,
          originalSummary: event.summary,
        },
      };

      events.push(eventData);
    }

    const jsonlContent = events.map((event) => JSON.stringify(event)).join("\n");
    fs.writeFileSync(jsonlPath, jsonlContent);

    console.log(`✅ Generated ${events.length} events in ${jsonlPath}`);
    if (skippedCount > 0) {
      console.log(`   ⏭️  ${skippedCount} events skipped (recurring instances)`);
    }
  }

  loadCredentials() {
    try {
      if (!fs.existsSync(CREDENTIALS_FILE)) {
        console.error(`❌ Credentials file not found: ${CREDENTIALS_FILE}`);
        console.log("📥 Download OAuth2 credentials from Google Cloud Console");
        process.exit(1);
      }

      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));

      let clientId, clientSecret;
      if (credentials.installed) {
        clientId = credentials.installed.client_id;
        clientSecret = credentials.installed.client_secret;
      } else if (credentials.web) {
        clientId = credentials.web.client_id;
        clientSecret = credentials.web.client_secret;
      } else {
        throw new Error("Invalid credentials file format");
      }

      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
      console.log("✅ Credentials loaded successfully");
    } catch (error) {
      console.error("❌ Failed to load credentials:", error.message);
      process.exit(1);
    }
  }

  async loadSavedTokens() {
    try {
      if (fs.existsSync("data/tokens.json")) {
        const tokens = JSON.parse(fs.readFileSync("data/tokens.json", "utf8"));
        this.oauth2Client.setCredentials(tokens);
        this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
        console.log("✅ Using saved authorization tokens");
        return true;
      }
    } catch (error) {
      console.log("⚠️  Could not load saved tokens, need fresh authorization");
    }
    return false;
  }

  async authorize() {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar"],
      prompt: "consent",
    });

    console.log("\n🔐 AUTHORIZATION REQUIRED");
    console.log("1. Visit this URL:", authUrl);
    console.log("2. Grant permission and copy the code");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question("\nEnter authorization code: ", async (code) => {
        rl.close();
        try {
          const { tokens } = await this.oauth2Client.getToken(code);
          this.oauth2Client.setCredentials(tokens);

          fs.writeFileSync("data/tokens.json", JSON.stringify(tokens, null, 2));
          console.log("✅ Authorization successful!");

          this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
          resolve();
        } catch (error) {
          console.error("❌ Authorization failed:", error.message);
          process.exit(1);
        }
      });
    });
  }

  async checkEventExists(iCalUID, calendarId = "primary") {
    try {
      const response = await this.calendar.events.list({
        calendarId: calendarId,
        iCalUID: iCalUID,
        maxResults: 1,
      });
      return response.data.items && response.data.items.length > 0;
    } catch (error) {
      return false;
    }
  }

  convertICSToGoogleEvent(icsEvent) {
    const recurrenceIdProp = icsEvent.component.getFirstProperty("recurrence-id");
    const isRecurrenceException = !!recurrenceIdProp;

    // If this is a recurring event instance (contains _R followed by date),
    // skip it - we'll import the main recurring event instead
    if (icsEvent.uid && !isRecurrenceException) {
      const recurringMatch = icsEvent.uid.match(/^(.+)_R\d{8}T?\d*(@.+)?$/);
      if (recurringMatch) {
        console.log(`   ⏭️  Skipping recurring event instance: ${icsEvent.summary}`);
        return null; // Signal to skip this event
      }
    }

    // Preserve original UID to maintain connections for RSVPs and updates
    const iCalUID =
      icsEvent.uid || `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (isRecurrenceException) {
      console.log(`🔄 Processing recurrence exception for: ${icsEvent.summary}`);
    }

    const event = {
      summary: icsEvent.summary,
      description: icsEvent.description || "",
      location: icsEvent.location || "",
      iCalUID: iCalUID,
    };

    if (isRecurrenceException) {
      const recurrenceId = recurrenceIdProp.getFirstValue();
      if (recurrenceId) {
        event.originalStartTime = {
          dateTime: recurrenceId.toJSDate().toISOString(),
          timeZone: recurrenceId.timezone || "UTC",
        };
      }
      // Mark for special handling during import
      event._isRecurrenceException = true;
    }

    if (icsEvent.startDate) {
      event.start = {
        dateTime: icsEvent.startDate.toJSDate().toISOString(),
        timeZone: icsEvent.startDate.timezone || "UTC",
      };
    }

    if (icsEvent.endDate) {
      event.end = {
        dateTime: icsEvent.endDate.toJSDate().toISOString(),
        timeZone: icsEvent.endDate.timezone || "UTC",
      };
    }

    const rruleProp = icsEvent.component.getFirstProperty("rrule");
    if (rruleProp) {
      const rruleValue = rruleProp.getFirstValue();
      if (rruleValue) {
        const recurrence = this.convertICalRRuleToGoogle(rruleValue);
        if (recurrence) {
          event.recurrence = [recurrence];
        }
      }
    }

    // Handle organizer using email aliases or name mappings
    const organizerProp = icsEvent.component.getFirstProperty("organizer");
    if (organizerProp) {
      const originalEmail = this.extractEmail(organizerProp.getFirstValue());
      const organizerName = organizerProp.getParameter("cn");

      let finalEmail = null;
      let finalName = organizerName;

      if (originalEmail) {
        finalEmail = this.emailAliases[originalEmail] || originalEmail;
      } else if (organizerName) {
        finalEmail = this.nameToEmail[organizerName];
        if (!finalEmail) {
          console.log(`⚠️  No email mapping found for organizer "${organizerName}"`);
          return event; // Safer to skip organizer than fail entire event
        }
      }

      if (finalEmail) {
        event.organizer = {
          email: finalEmail,
          displayName: finalName || finalEmail,
        };
      }
    }

    // Handle attendees using email aliases or name mappings
    const attendeeProps = icsEvent.component.getAllProperties("attendee");
    if (attendeeProps && attendeeProps.length > 0) {
      event.attendees = [];

      for (const attendeeProp of attendeeProps) {
        const originalEmail = this.extractEmail(attendeeProp.getFirstValue());
        const attendeeName = attendeeProp.getParameter("cn");
        const partstat = attendeeProp.getParameter("partstat");

        let finalEmail = null;
        let finalName = attendeeName;

        if (originalEmail) {
          finalEmail = this.emailAliases[originalEmail] || originalEmail;
        } else if (attendeeName) {
          finalEmail = this.nameToEmail[attendeeName];
          if (!finalEmail) {
            console.log(`⚠️  No email mapping found for attendee "${attendeeName}", skipping`);
            continue; // Skip individual attendee rather than fail entire event
          }
        }

        if (finalEmail) {
          event.attendees.push({
            email: finalEmail,
            displayName: finalName || finalEmail,
            responseStatus: this.convertPartStat(partstat),
            optional: false,
          });
        }
      }

      if (event.attendees.length === 0) {
        delete event.attendees;
      }
    }

    return event;
  }

  convertPartStat(partstat) {
    const mapping = {
      ACCEPTED: "accepted",
      DECLINED: "declined",
      TENTATIVE: "tentative",
      "NEEDS-ACTION": "needsAction",
    };
    return mapping[partstat] || "needsAction";
  }

  convertICalRRuleToGoogle(rrule) {
    try {
      let ruleStr = "RRULE:";
      const parts = [];

      if (rrule.freq) {
        parts.push(`FREQ=${rrule.freq}`);
      }

      if (rrule.interval && rrule.interval > 1) {
        parts.push(`INTERVAL=${rrule.interval}`);
      }

      if (rrule.until) {
        // Google Calendar requires UTC format for UNTIL dates
        const untilDate = rrule.until.toJSDate();
        const year = untilDate.getUTCFullYear();
        const month = String(untilDate.getUTCMonth() + 1).padStart(2, "0");
        const day = String(untilDate.getUTCDate()).padStart(2, "0");
        const hour = String(untilDate.getUTCHours()).padStart(2, "0");
        const minute = String(untilDate.getUTCMinutes()).padStart(2, "0");
        const second = String(untilDate.getUTCSeconds()).padStart(2, "0");
        parts.push(`UNTIL=${year}${month}${day}T${hour}${minute}${second}Z`);
      }

      if (rrule.count) {
        parts.push(`COUNT=${rrule.count}`);
      }

      const byday = rrule.byday || rrule.parts?.BYDAY;
      if (byday && byday.length > 0) {
        const days = byday
          .map((day) => {
            if (typeof day === "string") {
              return day;
            } else if (day.day) {
              return day.pos ? `${day.pos}${day.day}` : day.day;
            }
            return "";
          })
          .filter((d) => d);
        if (days.length > 0) {
          parts.push(`BYDAY=${days.join(",")}`);
        }
      }

      const bymonthday = rrule.bymonthday || rrule.parts?.BYMONTHDAY;
      if (bymonthday && bymonthday.length > 0) {
        parts.push(`BYMONTHDAY=${bymonthday.join(",")}`);
      }

      const bymonth = rrule.bymonth || rrule.parts?.BYMONTH;
      if (bymonth && bymonth.length > 0) {
        parts.push(`BYMONTH=${bymonth.join(",")}`);
      }

      return parts.length > 0 ? ruleStr + parts.join(";") : null;
    } catch (error) {
      console.error("⚠️  Could not convert recurrence rule:", error.message);
      return null;
    }
  }

  loadCheckpoint(icsFilePath) {
    const sidecarPath = `${icsFilePath}.position`;
    try {
      if (fs.existsSync(sidecarPath)) {
        const position = parseInt(fs.readFileSync(sidecarPath, "utf8").trim());
        console.log(`📌 Found checkpoint: Resuming from event ${position + 1}`);
        return position;
      }
    } catch (error) {
      console.log("⚠️  Could not load checkpoint, starting from beginning");
    }
    return -1;
  }

  saveCheckpoint(icsFilePath, position) {
    const sidecarPath = `${icsFilePath}.position`;
    try {
      fs.writeFileSync(sidecarPath, position.toString());
    } catch (error) {
      console.error("⚠️  Could not save checkpoint:", error.message);
    }
  }

  removeCheckpoint(icsFilePath) {
    const sidecarPath = `${icsFilePath}.position`;
    try {
      if (fs.existsSync(sidecarPath)) {
        fs.unlinkSync(sidecarPath);
        console.log("🧹 Cleaned up checkpoint file");
      }
    } catch (error) {
      console.error("⚠️  Could not remove checkpoint file:", error.message);
    }
  }

  async processJSONLFile(jsonlPath, icsFilePath, calendarId = "primary") {
    try {
      console.log("🚀 PROCESS MODE: Importing to Google Calendar\n");

      this.loadCredentials();

      const hasTokens = await this.loadSavedTokens();
      if (!hasTokens) {
        await this.authorize();
      }

      console.log(`📅 Processing events from: ${jsonlPath}`);

      const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      const events = jsonlContent
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      console.log(`Found ${events.length} event(s) to process`);
      if (this.checkDuplicates) {
        console.log("🔍 Duplicate checking is ENABLED");
      } else {
        console.log("⚡ Duplicate checking is DISABLED (faster imports)");
      }

      const startPosition = this.loadCheckpoint(icsFilePath);
      console.log("");

      let successCount = 0;
      let skippedCount = 0;
      let resumedCount = 0;

      for (let i = 0; i < events.length; i++) {
        if (i <= startPosition) {
          resumedCount++;
          continue;
        }

        const eventData = events[i];
        let googleEvent = null;

        try {
          const { _metadata, _isRecurrenceException, ...googleEvent } = eventData;
          const cleanEvent = googleEvent;

          if (this.checkDuplicates) {
            const exists = await this.checkEventExists(cleanEvent.iCalUID, calendarId);
            if (exists) {
              console.log(`⏭️  Skipped (exists): ${cleanEvent.summary}`);
              skippedCount++;
              continue;
            }
          }

          let response;

          response = await this.calendar.events.import({
            calendarId: calendarId,
            supportsAttendees: true,
            resource: cleanEvent,
          });

          // Update ensures recurrence rules are properly processed by Google Calendar
          if (_metadata.hasRecurrence && !_metadata.isRecurrenceException) {
            response = await this.calendar.events.update({
              calendarId: calendarId,
              eventId: response.data.id,
              supportsAttendees: true,
              resource: cleanEvent,
            });
          }

          let eventType = "";
          if (_metadata.hasRecurrence) {
            eventType = " 🔁 (RECURRING)";
          } else if (_metadata.isRecurrenceException) {
            eventType = " 🔄 (EXCEPTION)";
          }

          console.log(`✅ Imported: ${cleanEvent.summary}${eventType}`);
          console.log(
            `   📧 Organizer: ${cleanEvent.organizer?.displayName || "None"} (${cleanEvent.organizer?.email || "No email"})`,
          );
          console.log(`   👥 Attendees: ${cleanEvent.attendees?.length || 0}`);
          if (_metadata.hasRecurrence) {
            console.log(`   🔁 Recurrence: ${cleanEvent.recurrence[0]}`);
          }
          if (_metadata.isRecurrenceException) {
            console.log(`   🔄 Exception to recurring event: ${cleanEvent.iCalUID}`);
            if (cleanEvent.originalStartTime) {
              console.log(`   📅 Original time: ${cleanEvent.originalStartTime.dateTime}`);
            }
          }

          successCount++;
          this.saveCheckpoint(icsFilePath, i);
        } catch (eventError) {
          const errorMessage = eventError.message || "Unknown error";
          console.error(`❌ Failed to import: ${errorMessage}`);

          if (errorMessage.includes("Bad Request")) {
            console.error("   🔍 This might be due to:");
            console.error("      - Invalid date/time format");
            console.error("      - Missing required fields");
            console.error("      - Recurring event issues");
            console.error("      - Invalid attendee email addresses");
          } else if (errorMessage.includes("Forbidden")) {
            console.error("   🔒 This might be due to:");
            console.error("      - Insufficient permissions on the target calendar");
            console.error("      - Event already exists in a calendar you cannot modify");
            console.error("      - Calendar API quota exceeded");
            console.error("      - Event organizer restrictions");
          }

          if (eventData) {
            console.error("📄 Event data:", JSON.stringify(eventData, null, 2));
          }

          if (this.skipErrors) {
            console.error("⚠️  Skipping this event and continuing...");
            continue;
          } else {
            console.error(
              "\n🛑 Import stopped. To skip failed events and continue, set SKIP_ERRORS=1",
            );
            process.exit(1);
          }
        }
      }

      console.log(`\n🎉 Import complete!`);
      console.log(`   ✅ ${successCount} events imported`);
      if (resumedCount > 0) {
        console.log(`   ⏩ ${resumedCount} events already processed`);
      }
      console.log(`   ⏭️  ${skippedCount} events skipped`);

      this.removeCheckpoint(icsFilePath);
    } catch (error) {
      console.error("❌ Process failed:", error.message);
      process.exit(1);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    command: null,
    inputFile: null,
    calendarId: "primary",
    checkDuplicates: false,
    skipErrors: false,
  };

  if (args.length < 2) {
    return parsed;
  }

  // First two arguments are always command and file
  parsed.command = args[0];
  parsed.inputFile = args[1];

  // Parse remaining arguments as options
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--calendar-id") {
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed.calendarId = args[i + 1];
        i++; // Skip next argument since we consumed it
      } else {
        console.error("❌ --calendar-id requires a value");
        process.exit(1);
      }
    } else if (arg === "--check-duplicates") {
      parsed.checkDuplicates = true;
    } else if (arg === "--skip-errors") {
      parsed.skipErrors = true;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else {
      console.error(`❌ Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  return parsed;
}

function showHelp() {
  console.log(`Usage:
  node ics-import.js prepare <file.ics> [options]
  node ics-import.js process <file.jsonl> [options]

Commands:
  prepare    Scan ICS file and build email/name mappings
  process    Import events to Google Calendar from JSONL file

Options:
  --calendar-id <id>     Target calendar ID (default: primary)
  --check-duplicates     Enable duplicate event checking (slower)
  --skip-errors          Skip failed events and continue
  --help, -h             Show this help message

Examples:
  node ics-import.js prepare data/calendar.ics
  node ics-import.js process data/calendar.ics.jsonl
  node ics-import.js process data/calendar.ics.jsonl --calendar-id work@group.calendar.google.com
  node ics-import.js process data/calendar.ics.jsonl --check-duplicates --skip-errors`);
}

async function main() {
  const args = parseArgs();

  if (!args.command || !args.inputFile) {
    showHelp();
    process.exit(1);
  }

  if (!fs.existsSync(args.inputFile)) {
    console.error(`❌ File not found: ${args.inputFile}`);
    process.exit(1);
  }

  const importer = new CalendarImporter();

  // Override instance settings with command line options
  importer.checkDuplicates = args.checkDuplicates;
  importer.skipErrors = args.skipErrors;

  switch (args.command) {
    case "prepare":
      if (!args.inputFile.endsWith(".ics")) {
        console.error("❌ Prepare command requires an ICS file (.ics extension)");
        process.exit(1);
      }
      await importer.prepareEmails(args.inputFile);
      break;
    case "process":
      if (!args.inputFile.endsWith(".jsonl")) {
        console.error("❌ Process command requires a JSONL file (.jsonl extension)");
        console.log("💡 Run prepare first to generate the JSONL file from your ICS file");
        process.exit(1);
      }

      if (args.calendarId !== "primary") {
        console.log(`📅 Target calendar: ${args.calendarId}`);
      } else {
        console.log("📅 Target calendar: primary");
      }

      // Extract the original ICS path for checkpoint operations
      const icsPath = args.inputFile.replace(".jsonl", "");
      await importer.processJSONLFile(args.inputFile, icsPath, args.calendarId);
      break;
    default:
      console.error(`❌ Unknown command: ${args.command}`);
      console.log("Valid commands: prepare, process");
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = CalendarImporter;
