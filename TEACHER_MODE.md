# Teacher Mode

Teacher Mode is part of the existing Orlando Science Class Timer interface. It shares the app's Lora and Poppins typography, backgrounds, light/dark appearance, glass panels, and buttons. No Hall Pass Board CSS or Patrick Hand font is loaded.

## Entry and settings

The first open asks Student or Teacher. The choice is stored on the device and can be changed in Student Settings or on the Teacher dashboard. On first entering Teacher Mode, open Teacher Settings to choose the grade band (9th/12th or 10th/11th), room and display name. The original student timer, student profile settings, A/B rotation, and bells remain separate.

## Hall passes

Connect the **existing school's Google Apps Script** using the school-issued teacher code in Teacher Settings. There is no Supabase dependency and no database migration. Never commit a roster, student record, teacher code or live API key.

The verified school response supplies only that teacher's A1–B4 rosters, course names, rooms and grade-specific groups. Start a pass by choosing a student and destination, with a customizable auto-leave delay. Students tap Returned when back, or Cancel for mistaken trips. Trips are recorded as Returned or Cancelled. The 10/10 rule can be configured or bypassed once by a teacher. Customize simultaneous slots and destination time limits.

Completed trips are queued if school connectivity fails and retried on reconnect. A separate TEST setting marks logged trial trips; **Demo** uses sample names and never uploads a trip to Google Sheets. The device can export its recent pass history as CSV.

## Other classroom tools

- Official 2026–27 school calendar with 9th/12th and 10th/11th grade bell times, no-school dates, A/B days, date overrides and multi-group class windows
- Lesson progress and open/closed pass windows
- Timer: presets, pause/resume, timed warning, end sound, keypad and recent times
- Bell notifications, attention sound, teacher PIN, manual clock offsets, drift, optional network time sync
- A1–B4 lesson agendas, optional daily reset, optional announcements, weather and NWS alerts (when connected), rotating classroom cards
- Upload sounds to local browser storage or list school-provided sounds in `teacher-sounds/`
- Offline shell, installable web-app manifest and fullscreen mode. Internet is still required for fresh rosters, weather and remote logging; previously cached rosters remain local to the browser.

## School deployment

This integration reuses the upstream Google Sheets/Apps Script service. The school administrator must ensure `apps-script/Code.gs` from the upstream [Hall Pass Board](https://github.com/orlandoscience/hallpass) is installed and deployed, the schedule is imported, codes created and permissions set. Classroom teachers should receive codes privately. The script URL alone does **not** give access to student information.

## Copyright and permitted use

Hall Pass Board data/protocol and school-use features are credited to **Shamil Ganiev (2026)**. This integration is for permitted school use under the Free School Use License in [HALLPASS-LICENSE.md](HALLPASS-LICENSE.md). The separate [third-party notices](HALLPASS-THIRD-PARTY-NOTICES.md) are retained. Do not sell this derivative without written permission.
