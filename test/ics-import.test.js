const fs = require("fs");
const path = require("path");
const CalendarImporter = require("../ics-import.js");

// Mock console methods to suppress output during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeEach(() => {
  console.log = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

describe("CalendarImporter", () => {
  let importer;
  const fixtureDir = path.join(__dirname, "fixtures");
  const testDataDir = path.join(__dirname, "test-data");
  const sampleIcsPath = path.join(fixtureDir, "sample.ics");

  beforeEach(() => {
    // Create test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
    fs.mkdirSync(testDataDir, { recursive: true });

    // Create mock email aliases and name mappings
    const emailAliases = {
      "john.doe@example.com": "john.doe@example.com",
      "jane.smith@example.com": "jane.smith@example.com",
      "bob.wilson@example.com": "bob.wilson@example.com",
      "team.lead@example.com": "team.lead@example.com",
      "dev1@example.com": "dev1@example.com",
      "dev2@example.com": "dev2@example.com",
      invalid_email_format: "fixed@example.com",
    };

    const nameToEmail = {
      "No Email Person": "noemail@example.com",
    };

    fs.writeFileSync(
      path.join(testDataDir, "email_aliases.json"),
      JSON.stringify(emailAliases, null, 2),
    );

    fs.writeFileSync(
      path.join(testDataDir, "name_to_email.json"),
      JSON.stringify(nameToEmail, null, 2),
    );

    // Create a test instance with mocked paths
    importer = new CalendarImporter();
    importer.emailAliases = emailAliases;
    importer.nameToEmail = nameToEmail;
    importer.checkDuplicates = false;
    importer.skipErrors = false;
  });

  afterEach(() => {
    // Clean up test data directory
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true });
    }
  });

  describe("extractAllEmailsAndNames", () => {
    test("should extract emails and names from ICS file", async () => {
      const result = await importer.extractAllEmailsAndNames(sampleIcsPath);

      expect(result.emails).toContain("john.doe@example.com");
      expect(result.emails).toContain("jane.smith@example.com");
      expect(result.emails).toContain("bob.wilson@example.com");
      expect(result.emails).toContain("team.lead@example.com");
      expect(result.emails).toContain("dev1@example.com");
      expect(result.emails).toContain("dev2@example.com");
      expect(result.emails).toContain("invalid_email_format");

      expect(result.names).toContain("No Email Person");
    });
  });

  describe("isValidEmail", () => {
    test("should validate correct email addresses", () => {
      expect(importer.isValidEmail("test@example.com")).toBe(true);
      expect(importer.isValidEmail("user.name+tag@domain.co.uk")).toBe(true);
    });

    test("should reject invalid email addresses", () => {
      expect(importer.isValidEmail("invalid_email_format")).toBe(false);
      expect(importer.isValidEmail("missing@")).toBe(false);
      expect(importer.isValidEmail("@domain.com")).toBe(false);
      expect(importer.isValidEmail("spaces in@email.com")).toBe(false);
    });
  });

  describe("convertICSToGoogleEvent", () => {
    test("should convert simple ICS event to Google Calendar format", () => {
      const ICAL = require("ical.js");
      const icsData = fs.readFileSync(sampleIcsPath, "utf8");
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");

      const simpleEvent = new ICAL.Event(vevents[0]); // First event
      const googleEvent = importer.convertICSToGoogleEvent(simpleEvent);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.summary).toBe("Simple Meeting");
      expect(googleEvent.description).toBe("A simple test meeting");
      expect(googleEvent.location).toBe("Conference Room A");
      expect(googleEvent.iCalUID).toBe("simple-event@example.com");

      expect(googleEvent.organizer).toBeTruthy();
      expect(googleEvent.organizer.email).toBe("john.doe@example.com");
      expect(googleEvent.organizer.displayName).toBe("John Doe");

      expect(googleEvent.attendees).toHaveLength(2);
      expect(googleEvent.attendees[0].email).toBe("jane.smith@example.com");
      expect(googleEvent.attendees[0].responseStatus).toBe("accepted");
      expect(googleEvent.attendees[1].email).toBe("bob.wilson@example.com");
      expect(googleEvent.attendees[1].responseStatus).toBe("tentative");
    });

    test("should handle recurring events", () => {
      const ICAL = require("ical.js");
      const icsData = fs.readFileSync(sampleIcsPath, "utf8");
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");

      const recurringEvent = new ICAL.Event(vevents[1]); // Second event (recurring)
      const googleEvent = importer.convertICSToGoogleEvent(recurringEvent);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.summary).toBe("Weekly Team Meeting");
      expect(googleEvent.recurrence).toBeTruthy();
      expect(googleEvent.recurrence[0]).toContain("FREQ=WEEKLY");
      expect(googleEvent.recurrence[0]).toContain("BYDAY=WE");
      expect(googleEvent.recurrence[0]).toContain("COUNT=10");
    });

    test("should handle recurrence exceptions", () => {
      const ICAL = require("ical.js");
      const icsData = fs.readFileSync(sampleIcsPath, "utf8");
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");

      const exceptionEvent = new ICAL.Event(vevents[2]); // Third event (exception)
      const googleEvent = importer.convertICSToGoogleEvent(exceptionEvent);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.summary).toBe("Weekly Team Meeting (Moved)");
      expect(googleEvent._isRecurrenceException).toBe(true);
      expect(googleEvent.originalStartTime).toBeTruthy();
    });

    test("should skip recurring event instances", () => {
      const ICAL = require("ical.js");
      const icsData = fs.readFileSync(sampleIcsPath, "utf8");
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");

      const instanceEvent = new ICAL.Event(vevents[4]); // Fifth event (instance)
      const googleEvent = importer.convertICSToGoogleEvent(instanceEvent);

      expect(googleEvent).toBeNull(); // Should be skipped
    });

    test("should handle events with invalid emails using aliases", () => {
      const ICAL = require("ical.js");
      const icsData = fs.readFileSync(sampleIcsPath, "utf8");
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");

      const invalidEmailEvent = new ICAL.Event(vevents[3]); // Fourth event
      const googleEvent = importer.convertICSToGoogleEvent(invalidEmailEvent);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.organizer.email).toBe("fixed@example.com"); // From email alias
      expect(googleEvent.attendees).toHaveLength(1);
      expect(googleEvent.attendees[0].email).toBe("noemail@example.com"); // From name mapping
    });
  });

  describe("generateEventsJSON", () => {
    test("should generate JSONL file with correct event data and metadata", async () => {
      const testIcsPath = path.join(testDataDir, "test.ics");
      const jsonlPath = `${testIcsPath}.jsonl`;

      // Copy sample ICS to test data directory
      fs.copyFileSync(sampleIcsPath, testIcsPath);

      await importer.generateEventsJSON(testIcsPath);

      expect(fs.existsSync(jsonlPath)).toBe(true);

      const jsonlContent = fs.readFileSync(jsonlPath, "utf8");
      const events = jsonlContent
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Should have 4 events (1 simple + 1 recurring + 1 exception + 1 invalid email, skipping 1 instance)
      expect(events).toHaveLength(4);

      // Check simple event
      const simpleEvent = events.find((e) => e.summary === "Simple Meeting");
      expect(simpleEvent).toBeTruthy();
      expect(simpleEvent._metadata).toBeTruthy();
      expect(simpleEvent._metadata.isRecurrenceException).toBe(false);
      expect(simpleEvent._metadata.hasRecurrence).toBe(false);
      expect(simpleEvent._metadata.originalICalUID).toBe("simple-event@example.com");
      expect(simpleEvent._metadata.originalSummary).toBe("Simple Meeting");

      // Check recurring event
      const recurringEvent = events.find(
        (e) => e.summary === "Weekly Team Meeting" && !e._isRecurrenceException,
      );
      expect(recurringEvent).toBeTruthy();
      expect(recurringEvent._metadata.hasRecurrence).toBe(true);
      expect(recurringEvent._metadata.isRecurrenceException).toBe(false);

      // Check recurrence exception
      const exceptionEvent = events.find((e) => e.summary === "Weekly Team Meeting (Moved)");
      expect(exceptionEvent).toBeTruthy();
      expect(exceptionEvent._metadata.isRecurrenceException).toBe(true);
      expect(exceptionEvent._metadata.hasRecurrence).toBe(false);

      // Check that recurring instance was skipped
      const instanceEvent = events.find((e) => e.summary === "Weekly Team Meeting Instance");
      expect(instanceEvent).toBeFalsy();
    });

    test("should handle events with no organizer or attendees", () => {
      const ICAL = require("ical.js");

      // Create minimal ICS event
      const minimalIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:minimal-event@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Minimal Event
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(minimalIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.summary).toBe("Minimal Event");
      expect(googleEvent.organizer).toBeUndefined();
      expect(googleEvent.attendees).toBeUndefined();
    });

    test("should handle events with empty summary and description", () => {
      const ICAL = require("ical.js");

      const emptyFieldsIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:empty-fields@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:
DESCRIPTION:
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(emptyFieldsIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.summary).toBe("");
      expect(googleEvent.description).toBe("");
    });

    test("should handle organizer with email but no display name", () => {
      const ICAL = require("ical.js");

      const noNameIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:no-name@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:No Name Event
ORGANIZER:mailto:organizer@example.com
END:VEVENT
END:VCALENDAR`;

      // Add this email to our test aliases
      importer.emailAliases["organizer@example.com"] = "organizer@example.com";

      const jcalData = ICAL.parse(noNameIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.organizer.email).toBe("organizer@example.com");
      expect(googleEvent.organizer.displayName).toBe("organizer@example.com"); // Falls back to email
    });

    test("should handle attendee with RSVP parameter", () => {
      const ICAL = require("ical.js");

      const rsvpIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:rsvp-event@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:RSVP Event
ORGANIZER;CN=Host:mailto:host@example.com
ATTENDEE;CN=Guest;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:guest@example.com
END:VEVENT
END:VCALENDAR`;

      // Add emails to test aliases
      importer.emailAliases["host@example.com"] = "host@example.com";
      importer.emailAliases["guest@example.com"] = "guest@example.com";

      const jcalData = ICAL.parse(rsvpIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.attendees).toHaveLength(1);
      expect(googleEvent.attendees[0].email).toBe("guest@example.com");
      expect(googleEvent.attendees[0].responseStatus).toBe("needsAction");
    });

    test("should handle malformed email extraction", () => {
      expect(importer.extractEmail(null)).toBeNull();
      expect(importer.extractEmail(undefined)).toBeNull();
      expect(importer.extractEmail("")).toBeNull();
      expect(importer.extractEmail("   ")).toBeNull();
      expect(importer.extractEmail("mailto:")).toBeNull();
      expect(importer.extractEmail("MAILTO:test@example.com")).toBe("test@example.com");
    });

    test("should handle complex RRULE with multiple components", () => {
      const ICAL = require("ical.js");

      const complexRruleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:complex-rrule@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Complex Recurring Event
RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1MO,3FR;BYMONTH=1,3,5,7,9,11;COUNT=12
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(complexRruleIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.recurrence).toBeTruthy();
      const rrule = googleEvent.recurrence[0];
      expect(rrule).toContain("FREQ=MONTHLY");
      expect(rrule).toContain("INTERVAL=2");
      expect(rrule).toContain("BYDAY=1MO,3FR");
      expect(rrule).toContain("BYMONTH=1,3,5,7,9,11");
      expect(rrule).toContain("COUNT=12");
    });

    test("should handle events with missing UID", () => {
      const ICAL = require("ical.js");

      const noUidIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:No UID Event
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(noUidIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.iCalUID).toMatch(/^imported-\d+-[a-z0-9]+$/); // Generated UID pattern
    });

    test("should handle organizer with name but missing email mapping", () => {
      const ICAL = require("ical.js");

      const missingMappingIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:missing-mapping@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Missing Mapping Event
ORGANIZER;CN=Unknown Person:
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(missingMappingIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.organizer).toBeUndefined(); // Should be skipped when no mapping found
    });

    test("should skip all attendees when none have valid emails", () => {
      const ICAL = require("ical.js");

      const invalidAttendeesIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:invalid-attendees@example.com
DTSTAMP:20240301T120000Z
DTSTART:20240315T140000Z
DTEND:20240315T150000Z
SUMMARY:Invalid Attendees Event
ATTENDEE;CN=Unknown Person One:
ATTENDEE;CN=Unknown Person Two:
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(invalidAttendeesIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);
      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.attendees).toBeUndefined(); // Should be undefined when all attendees skipped
    });
  });

  describe("checkpoint functionality", () => {
    test("should load checkpoint when file exists", () => {
      const checkpointPath = path.join(testDataDir, "test.ics.position");
      fs.writeFileSync(checkpointPath, "5");

      const position = importer.loadCheckpoint(path.join(testDataDir, "test.ics"));
      expect(position).toBe(5);
    });

    test("should return -1 when checkpoint file does not exist", () => {
      const position = importer.loadCheckpoint(path.join(testDataDir, "nonexistent.ics"));
      expect(position).toBe(-1);
    });

    test("should save checkpoint to file", () => {
      const icsPath = path.join(testDataDir, "test.ics");
      importer.saveCheckpoint(icsPath, 10);

      const checkpointPath = `${icsPath}.position`;
      expect(fs.existsSync(checkpointPath)).toBe(true);
      expect(fs.readFileSync(checkpointPath, "utf8")).toBe("10");
    });

    test("should remove checkpoint file", () => {
      const icsPath = path.join(testDataDir, "test.ics");
      const checkpointPath = `${icsPath}.position`;
      fs.writeFileSync(checkpointPath, "5");

      importer.removeCheckpoint(icsPath);
      expect(fs.existsSync(checkpointPath)).toBe(false);
    });
  });

  describe("file I/O operations", () => {
    test("should save and load email aliases", () => {
      const testAliases = {
        "invalid@test": "valid@test.com",
        "another@test": "another@test.com",
      };

      importer.emailAliases = testAliases;
      importer.saveEmailAliases();

      // Create new importer to test loading
      const newImporter = new CalendarImporter();
      const loadedAliases = newImporter.loadEmailAliases();

      expect(loadedAliases["invalid@test"]).toBe("valid@test.com");
      expect(loadedAliases["another@test"]).toBe("another@test.com");
    });

    test("should save and load name to email mappings", () => {
      const testMappings = {
        "John Doe": "john@test.com",
        "Jane Smith": "jane@test.com",
      };

      importer.nameToEmail = testMappings;
      importer.saveNameToEmail();

      // Create new importer to test loading
      const newImporter = new CalendarImporter();
      const loadedMappings = newImporter.loadNameToEmail();

      expect(loadedMappings["John Doe"]).toBe("john@test.com");
      expect(loadedMappings["Jane Smith"]).toBe("jane@test.com");
    });

    test("should handle missing mapping files gracefully", () => {
      const tempDir = path.join(testDataDir, "empty");
      fs.mkdirSync(tempDir);

      // Change to empty directory temporarily
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        // This tests the fallback behavior when files don't exist
        const testImporter = new CalendarImporter();
        expect(testImporter.emailAliases).toEqual({});
        expect(testImporter.nameToEmail).toEqual({});
      } finally {
        // Restore working directory
        process.chdir(originalCwd);
      }
    });
  });

  describe("default values", () => {
    test("should have correct default values", () => {
      const testImporter = new CalendarImporter();
      expect(testImporter.checkDuplicates).toBe(false);
      expect(testImporter.skipErrors).toBe(false);
    });
  });

  describe("PARTSTAT conversion", () => {
    test("should convert all PARTSTAT values correctly", () => {
      expect(importer.convertPartStat("ACCEPTED")).toBe("accepted");
      expect(importer.convertPartStat("DECLINED")).toBe("declined");
      expect(importer.convertPartStat("TENTATIVE")).toBe("tentative");
      expect(importer.convertPartStat("NEEDS-ACTION")).toBe("needsAction");
      expect(importer.convertPartStat("UNKNOWN")).toBe("needsAction"); // Default
      expect(importer.convertPartStat(null)).toBe("needsAction"); // Default
      expect(importer.convertPartStat(undefined)).toBe("needsAction"); // Default
    });
  });

  describe("timezone normalization", () => {
    test("should map Windows timezone names to IANA identifiers", () => {
      expect(importer.normalizeTimeZone("Central Standard Time")).toBe("America/Chicago");
      expect(importer.normalizeTimeZone("Eastern Standard Time")).toBe("America/New_York");
      expect(importer.normalizeTimeZone("Pacific Standard Time")).toBe("America/Los_Angeles");
      expect(importer.normalizeTimeZone("Mountain Standard Time")).toBe("America/Denver");
    });

    test("should handle daylight time variants", () => {
      expect(importer.normalizeTimeZone("Central Daylight Time")).toBe("America/Chicago");
      expect(importer.normalizeTimeZone("Eastern Daylight Time")).toBe("America/New_York");
      expect(importer.normalizeTimeZone("Pacific Daylight Time")).toBe("America/Los_Angeles");
      expect(importer.normalizeTimeZone("Mountain Daylight Time")).toBe("America/Denver");
    });

    test("should handle international timezones", () => {
      expect(importer.normalizeTimeZone("GMT Standard Time")).toBe("Europe/London");
      expect(importer.normalizeTimeZone("W. Europe Standard Time")).toBe("Europe/Berlin");
      expect(importer.normalizeTimeZone("Central Europe Standard Time")).toBe("Europe/Prague");
      expect(importer.normalizeTimeZone("Romance Standard Time")).toBe("Europe/Paris");
      expect(importer.normalizeTimeZone("China Standard Time")).toBe("Asia/Shanghai");
      expect(importer.normalizeTimeZone("Tokyo Standard Time")).toBe("Asia/Tokyo");
      expect(importer.normalizeTimeZone("India Standard Time")).toBe("Asia/Kolkata");
    });

    test("should pass through valid IANA timezone identifiers", () => {
      expect(importer.normalizeTimeZone("America/New_York")).toBe("America/New_York");
      expect(importer.normalizeTimeZone("Europe/London")).toBe("Europe/London");
      expect(importer.normalizeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
      expect(importer.normalizeTimeZone("Australia/Sydney")).toBe("Australia/Sydney");
    });

    test("should handle edge cases", () => {
      expect(importer.normalizeTimeZone(null)).toBe("UTC");
      expect(importer.normalizeTimeZone(undefined)).toBe("UTC");
      expect(importer.normalizeTimeZone("")).toBe("UTC");
    });

    test("should handle unknown timezone names gracefully", () => {
      expect(importer.normalizeTimeZone("Unknown Timezone")).toBe("Unknown Timezone");
      expect(importer.normalizeTimeZone("Custom/Zone")).toBe("Custom/Zone");
    });

    test("should handle timezone conversion in events", () => {
      const ICAL = require("ical.js");

      const timezoneIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test Calendar//EN
BEGIN:VEVENT
UID:timezone-event@example.com
DTSTAMP:20240301T120000Z
DTSTART;TZID=Central Standard Time:20240315T140000
DTEND;TZID=Central Standard Time:20240315T150000
SUMMARY:Timezone Test Event
END:VEVENT
END:VCALENDAR`;

      const jcalData = ICAL.parse(timezoneIcs);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents("vevent");
      const event = new ICAL.Event(vevents[0]);

      // Mock the timezone property
      event.startDate.timezone = "Central Standard Time";
      event.endDate.timezone = "Central Standard Time";

      const googleEvent = importer.convertICSToGoogleEvent(event);

      expect(googleEvent).toBeTruthy();
      expect(googleEvent.start.timeZone).toBe("America/Chicago");
      expect(googleEvent.end.timeZone).toBe("America/Chicago");
    });
  });

  describe("RRULE conversion edge cases", () => {
    test("should handle RRULE with UNTIL date", () => {
      const mockRrule = {
        freq: "WEEKLY",
        until: {
          toJSDate: () => new Date("2024-12-31T23:59:59Z"),
        },
      };

      const result = importer.convertICalRRuleToGoogle(mockRrule);
      expect(result).toContain("FREQ=WEEKLY");
      expect(result).toContain("UNTIL=20241231T235959Z");
    });

    test("should handle RRULE with BYSETPOS", () => {
      const mockRrule = {
        freq: "MONTHLY",
        parts: {
          BYDAY: ["MO"],
          BYSETPOS: [-1], // Last Monday
        },
      };

      const result = importer.convertICalRRuleToGoogle(mockRrule);
      expect(result).toContain("FREQ=MONTHLY");
      expect(result).toContain("BYDAY=MO");
      // Note: BYSETPOS would need to be added to the conversion logic
    });

    test("should handle malformed RRULE gracefully", () => {
      const mockRrule = {
        // Missing freq
        count: 5,
      };

      const result = importer.convertICalRRuleToGoogle(mockRrule);
      expect(result).toContain("COUNT=5");
    });
  });

  describe("data directory management", () => {
    test("should create data directory if it does not exist", () => {
      const testDir = path.join(testDataDir, "should-be-created");

      // Remove directory if it exists
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }

      // Change working directory temporarily
      const originalCwd = process.cwd();
      process.chdir(testDataDir);

      // Create importer which should create data directory
      const testImporter = new CalendarImporter();
      expect(fs.existsSync("data")).toBe(true);

      // Restore working directory
      process.chdir(originalCwd);
    });
  });
});

// Add integration tests for the auth command functionality
describe("Authentication functionality", () => {
  test("should have authenticateOnly method", () => {
    const testImporter = new CalendarImporter();
    expect(typeof testImporter.authenticateOnly).toBe("function");
  });

  test("should handle missing credentials gracefully", async () => {
    const testImporter = new CalendarImporter();

    // Mock the loadCredentials method to throw an error
    const originalLoadCredentials = testImporter.loadCredentials;
    testImporter.loadCredentials = jest.fn(() => {
      throw new Error("Credentials file not found");
    });

    // Mock process.exit to prevent actual exit
    const originalExit = process.exit;
    process.exit = jest.fn();

    try {
      await testImporter.authenticateOnly();
      expect(process.exit).toHaveBeenCalledWith(1);
    } finally {
      // Restore original methods
      testImporter.loadCredentials = originalLoadCredentials;
      process.exit = originalExit;
    }
  });

  test("should handle existing tokens", async () => {
    const testImporter = new CalendarImporter();

    // Mock the methods
    testImporter.loadCredentials = jest.fn();
    testImporter.loadSavedTokens = jest.fn().mockResolvedValue(true);

    await testImporter.authenticateOnly();

    expect(testImporter.loadCredentials).toHaveBeenCalled();
    expect(testImporter.loadSavedTokens).toHaveBeenCalled();
  });
});

describe("Sequence number handling", () => {
  let importer;

  beforeEach(() => {
    importer = new CalendarImporter();
    // Mock the calendar API
    importer.calendar = {
      events: {
        get: jest.fn(),
        update: jest.fn(),
      },
    };
  });

  test("should handle sequence number conflicts with retry", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 1 },
    });

    // Mock the first update to fail with sequence error, second to succeed
    importer.calendar.events.update
      .mockRejectedValueOnce(new Error("Invalid sequence value"))
      .mockResolvedValueOnce({ data: { id: eventId } });

    const result = await importer.updateEventWithRetry(calendarId, eventId, eventResource);

    expect(importer.calendar.events.get).toHaveBeenCalledTimes(2);
    expect(importer.calendar.events.update).toHaveBeenCalledTimes(2);
    expect(result.data.id).toBe(eventId);
  });

  test("should increment sequence number correctly", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response with sequence 5
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 5 },
    });

    // Mock successful update
    importer.calendar.events.update.mockResolvedValue({
      data: { id: eventId },
    });

    await importer.updateEventWithRetry(calendarId, eventId, eventResource);

    // Check that the update was called with incremented sequence
    expect(importer.calendar.events.update).toHaveBeenCalledWith({
      calendarId: calendarId,
      eventId: eventId,
      supportsAttendees: true,
      resource: {
        ...eventResource,
        sequence: 6, // 5 + 1
      },
    });
  });

  test("should handle missing sequence number", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response without sequence
    importer.calendar.events.get.mockResolvedValue({
      data: {},
    });

    // Mock successful update
    importer.calendar.events.update.mockResolvedValue({
      data: { id: eventId },
    });

    await importer.updateEventWithRetry(calendarId, eventId, eventResource);

    // Check that the update was called with sequence 1 (0 + 1)
    expect(importer.calendar.events.update).toHaveBeenCalledWith({
      calendarId: calendarId,
      eventId: eventId,
      supportsAttendees: true,
      resource: {
        ...eventResource,
        sequence: 1,
      },
    });
  });

  test("should throw error after max retries", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 1 },
    });

    // Mock all updates to fail with sequence error
    importer.calendar.events.update.mockRejectedValue(new Error("Invalid sequence value"));

    await expect(
      importer.updateEventWithRetry(calendarId, eventId, eventResource, 2),
    ).rejects.toThrow("Invalid sequence value");

    expect(importer.calendar.events.update).toHaveBeenCalledTimes(2);
  });

  test("should throw non-sequence errors immediately", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 1 },
    });

    // Mock update to fail with different error
    importer.calendar.events.update.mockRejectedValue(new Error("Some other error"));

    await expect(importer.updateEventWithRetry(calendarId, eventId, eventResource)).rejects.toThrow(
      "Some other error",
    );

    expect(importer.calendar.events.update).toHaveBeenCalledTimes(1);
  });

  test("should always throw an error when all retries fail", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response to succeed
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 1 },
    });

    // Mock update to always fail with sequence error
    importer.calendar.events.update.mockRejectedValue(new Error("Invalid sequence value"));

    // This should throw the last error, not return undefined
    await expect(
      importer.updateEventWithRetry(calendarId, eventId, eventResource, 1),
    ).rejects.toThrow("Invalid sequence value");

    expect(importer.calendar.events.update).toHaveBeenCalledTimes(1);
    expect(importer.calendar.events.get).toHaveBeenCalledTimes(1);
  });

  test("should not exit process when sequence errors are encountered", async () => {
    const calendarId = "primary";
    const eventId = "test-event-id";
    const eventResource = { summary: "Test Event" };

    // Mock the get response to succeed
    importer.calendar.events.get.mockResolvedValue({
      data: { sequence: 1 },
    });

    // Mock update to always fail with sequence error
    importer.calendar.events.update.mockRejectedValue(new Error("Invalid sequence value"));

    // Mock process.exit to track if it gets called
    const originalExit = process.exit;
    const mockExit = jest.fn();
    process.exit = mockExit;

    try {
      // This should throw an error but not call process.exit
      await expect(
        importer.updateEventWithRetry(calendarId, eventId, eventResource, 1),
      ).rejects.toThrow("Invalid sequence value");

      // Verify process.exit was never called during retry logic
      expect(mockExit).not.toHaveBeenCalled();
    } finally {
      // Restore original process.exit
      process.exit = originalExit;
    }
  });
});

describe("Sequence error detection", () => {
  let importer;

  beforeEach(() => {
    importer = new CalendarImporter();
  });

  test("should detect sequence errors correctly", () => {
    const sequenceErrors = [
      new Error("Invalid sequence value"),
      { message: "conflict", response: { status: 409 } },
      { message: "error", code: 409 },
    ];

    sequenceErrors.forEach((error) => {
      expect(importer.isSequenceError(error)).toBe(true);
    });
  });

  test("should not detect non-sequence errors as sequence errors", () => {
    const nonSequenceErrors = [
      new Error("Bad Request"),
      new Error("Forbidden"),
      new Error("Not found"),
      { message: "some other error", response: { status: 400 } },
      { message: "error", code: 500 },
    ];

    nonSequenceErrors.forEach((error) => {
      expect(importer.isSequenceError(error)).toBe(false);
    });
  });

  test("should handle malformed error objects", () => {
    const malformedErrors = [{}, { message: null }, { response: {} }, null, undefined];

    malformedErrors.forEach((error) => {
      expect(() => importer.isSequenceError(error)).not.toThrow();
      expect(importer.isSequenceError(error)).toBe(false);
    });
  });
});
