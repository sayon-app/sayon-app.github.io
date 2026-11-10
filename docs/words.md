# SAYON's words

One name for each thing, everywhere: on the screens, in the emails and PDFs, on the website and in the help. Check new wording against this page. `tests/words/e2e.js` reads the **Not** column and fails if one of those words is back on a screen, in an email or on a public page, so add a line here when a name is settled.

| Say | What it is | Not |
|---|---|---|
| **job** | One property's work, from Job details to Finalise: the agreement, the report, the quote, the treatment. Deleting, booking and the Jobs list are about jobs. | `Report deleted`, `Report restored`, `Inspection job` |
| **report** | The inspection report: its steps on screen and its PDF. | |
| **Job details** | The job's first step: the address, the client and the booking. Only that. | |
| **The visit** | The first part of a treatment record or a bait visit: when, who, the weather. | |
| **your note** | What the inspector says into the mic. Notes waiting to go in are saved notes. | `Voice capture` |
| **Say it** | The mic on a box or a sheet. | `Dictate`, `Dictating` |
| **Fill in the report** | The AI filling the report from a note. | `Extract data`, `AI ready` |
| **Describe** | The AI's caption for a photo. | `Analyse` |
| **Report done** | The inspector's mark that the report is finished. It can still change. | `Mark complete` |
| **Finalise** | A job's one ending: it locks the report and quote as a version and makes the job PDF. Amend unlocks it. | `Complete job` |
| **Book it in** | A new job from the Due list. | |
| **Business details** | The business's name, licence, ABN, phone, email and logo (Menu, Business details). | `Company details`, `company details` |
| **Download a copy** | The backup file of everything, to load back into SAYON. Not the PDFs. | `Export your data` |
| **Menu, Billing** | Where the plan is changed or cancelled. | `tap your initials` |
| **Email to Sam** | A button that sends says how and to whom. Once sent: Email again, Send it again. | `Send anyway` |
| **client** | The person the job is for. | |

The agreement's own wording (its numbered clauses) and the Terms and Privacy Policy are legal text: change them only with their version number, and they may say "voice notes" where they mean the recordings.

## Buttons

- **One filled button on a screen or sheet**: the one thing to do next. The others beside it are quiet. `tests/one-button/e2e.js` counts them on This job at each stage, every report step, the quote, Jobs and the main sheets.
- A button names what it does ("Delete job", "Pay $89 a month"), never OK.
- A question is asked on SAYON's own sheet (`askFirst`), never the browser's box.
