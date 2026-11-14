# SAYON's words

One name for each thing, everywhere: on the screens, in the emails and PDFs, on the website and in the help. Check new wording against this page. `tests/words/e2e.js` reads the **Not** column and fails if one of those words is back on a screen, in an email or on a public page, so add a line here when a name is settled.

| Say | What it is | Not |
|---|---|---|
| **job** | One property's work, from Job details to Finalise: the agreement, the report, the quote, the treatment. Deleting, booking and the Jobs list are about jobs. | `Report deleted`, `Report restored`, `Inspection job` |
| **report** | The inspection report: its steps on screen and its PDF. | |
| **Job details** | The job's first step: the address, the client and the booking. Only that. | |
| **new construction job** | A termite management system put in while the building goes up: Job details, then the treatment and its treatment certificate (to AS 3660.1). No agreement, report or quote. Its client is usually the builder. Chosen as the type of job. | |
| **special purpose inspection** | A termite inspection with a scope of its own (to AS 3660.2), often after an earlier one. Chosen as the type of job; Job details and the agreement then ask what it's for and the first inspection's no., and the report is a Special Purpose Termite Inspection Report. | |
| **The visit** | The first part of a treatment record or a bait visit: when, who, the weather. | |
| **your note** | What the inspector says into the mic. Notes waiting to go in are saved notes. | `Voice capture` |
| **Say it** | The mic on a box or a sheet. | `Dictate`, `Dictating` |
| **Fill in the report** | The AI filling the report from a note. | `Extract data`, `AI ready` |
| **Listening** | The mic on, as a bar on the dock: the newest words, Fill in (fills the report from what's been said so far and keeps listening) and the photo button. The report can still be used behind it. | `Recording mode` |
| **Lock for your pocket** | Covers the screen while listening so a pocket can't tap it. Press and hold the top label to unlock. | `Pocket mode`, `Screen lock` |
| **Describe** | The AI's caption for a photo. | `Analyse` |
| **Report done** | The inspector's mark that the report is finished. It can still change. | `Mark complete` |
| **Finalise** | A job's one ending: it locks the report and quote as a version and makes the job PDF. Amend unlocks it. | `Complete job` |
| **Book it in** | A new job from the Due list. | |
| **Safety check** | The technician's check before starting work on site: the questions, the hazards the SWMS doesn't cover (each with its control and risk score), the permits and their signature. One for each visit, done from This job. Kept with the job; not sent to the client. | |
| **Business details** | The business's name, licence, ABN, phone, email and logo (Menu, Business details). | `Company details`, `company details` |
| **Download a copy** | The backup file of everything, to load back into SAYON. Not the PDFs. | `Export your data` |
| **Menu, Billing** | Where the plan is changed or cancelled. | `tap your initials` |
| **Email to Sam** | A button that sends says how and to whom. Once sent: Email again, Send it again. | `Send anyway` |
| **treatment certificate** | The one certificate for the work done. A system left in place (a barrier, bait stations, reticulation) has its own row on it, System installed, and its own care lines. | `Certificate of Installation`, `Certificate of installation`, `installation certificate` |
| **site plan** | The drawing of the property: started on the report if the inspector wants one, and the treatment record adds the treatment and stations to it. | |
| **client** | The person the job is for. | |
| **Recheck later** | The areas to check again once they're unlocked, cleared or reachable (the report's High risk areas). Each area inspected with limits or not inspected is on it, with its own switch on the area's card. | |

The agreement's own wording (its numbered clauses) and the Terms and Privacy Policy are legal text: change them only with their version number, and they may say "voice notes" where they mean the recordings.

## Buttons

- **One filled button on a screen or sheet**: the one thing to do next. The others beside it are quiet. `tests/one-button/e2e.js` counts them on This job at each stage, every report step, the quote, Jobs and the main sheets.
- A button names what it does ("Delete job", "Pay $89 a month"), never OK.
- A question is asked on SAYON's own sheet (`askFirst`), never the browser's box.
