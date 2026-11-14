# 4. AU cost comparison: Twilio vs Plivo (Telnyx not yet priced)

Research date: **28 October 2026**. Public pay-as-you-go list prices, no negotiated discounts.
Region: AU numbers, AU customers, AU destinations only.

## Telnyx

Telnyx was added to the architecture on 3 November 2026 (see
[file 07](./07-telnyx-setup-and-pseudocode.md)). **Its Australian rates were not researched
and no figure in this file applies to it.** Before choosing Telnyx, read its AU voice, SMS
and number pricing pages and add a column using the same method and the USD 1 = AUD 1.50
planning rate. Check number rental, inbound/outbound per-minute rates to AU mobile and
landline, SMS segments, recording and any WebRTC/SIP charges.

## Currency, tax and method

- **Canonical currency: USD.** Both providers publish and invoice in USD. Plivo bills only in
  USD or INR.
- **AUD columns use a fixed planning rate of USD 1 = AUD 1.50.** This matches the other
  planning docs in this repository. The RBA rate in mid-October 2026 was about AUD 1.43 per
  USD; the planning rate adds about 5% headroom for FX movement and card conversion fees.
  Recalculate AUD when you quote: `AUD = USD × your rate`.
- **All figures exclude GST.** Whether a US-entity provider charges 10% GST depends on whether
  you are a GST-registered business with valid tax details on the account. Confirm with each
  provider's billing team.
- **Meta fees are identical on both providers.** WhatsApp template, service-message and
  business-initiated call fees are set by Meta per recipient country and passed through.
  Australia is in Meta's **"Rest of Asia Pacific"** pricing region.
- Per-minute figures are connected billable minutes. Ringing, IVR prompts, voicemail,
  rounding and transfer overlap add usage. Meta bills calls in 6-second pulses; provider
  increments were not stated on the pages read.
- Twilio's AU voice page **contradicts itself** on mobile vs toll-free inbound rates and
  rentals. The figures below use the summary table (mobile inbound USD 0.0100/min, mobile
  rental USD 8.25); the detail table swaps them (USD 0.0500/min). Get a console rate card
  before you commit.

## 1. Rate card: phone numbers and voice

| Meter                                |                                      Twilio USD |               Twilio AUD |                 Plivo USD |     Plivo AUD | Cheaper |
| ------------------------------------ | ----------------------------------------------: | -----------------------: | ------------------------: | ------------: | ------- |
| AU local number, per month           |                                          3.0000 |                   4.5000 |                    2.5000 |        3.7500 | Plivo   |
| AU mobile number, per month          |                                          8.2500 |                  12.3750 |                    5.0000 |        7.5000 | Plivo   |
| AU toll-free number, per month       |                                         20.0000 |                  30.0000 |                   12.0000 |       18.0000 | Plivo   |
| Receive on local, per min            |                                          0.0100 |                   0.0150 |                    0.0055 |        0.0083 | Plivo   |
| Receive on mobile, per min           |                                        0.0100 ¹ |                 0.0150 ¹ |                    0.0075 |        0.0113 | Plivo   |
| Receive on toll-free, per min        |                                        0.0500 ¹ |                 0.0750 ¹ |                    0.0400 |        0.0600 | Plivo   |
| Call AU landline, per min            |                                          0.0252 |                   0.0378 |                    0.0230 |        0.0345 | Plivo   |
| Call AU mobile, per min              |                                          0.0750 |                   0.1125 |                    0.0730 |        0.1095 | Plivo   |
| Browser SDK / SIP leg, per min       |                                          0.0040 |                   0.0060 |                    0.0033 |        0.0050 | Plivo   |
| Audio streaming (AI agent), per min  |                                          0.0044 |                   0.0066 |                  Included |      Included | Plivo   |
| Managed voice-AI relay, per min      |                      0.0700 (ConversationRelay) |                   0.1050 |               Not offered |             — | —       |
| Call recording, per min              |                                          0.0025 |                  0.00375 |                    0.0000 |        0.0000 | Plivo   |
| Recording storage, per min per month |                                          0.0005 |                  0.00075 | Free 90 days, then 0.0004 |        0.0006 | Plivo   |
| Provider transcription, per min      | 0.0240 batch / 0.0270 streaming / 0.0500 legacy | 0.0360 / 0.0405 / 0.0750 |                    0.0095 |        0.0143 | Plivo   |
| Speech recognition (IVR)             | Included in `<Gather>` speech pricing; `VERIFY` |                        — |             0.02 per 15 s | 0.03 per 15 s | —       |
| Answering machine detection          |                                 0.0075 per call |                  0.01125 |                    0.0000 |        0.0000 | Plivo   |
| Conference, per participant per min  |                                     from 0.0018 |                   0.0027 |                    0.0000 |        0.0000 | Plivo   |
| Text-to-speech                       |         Basic free; neural 0.0032 per 100 chars |                   0.0048 |   Free (multilingual TTS) |             0 | Plivo   |

¹ Twilio's page contradicts itself; see the method notes above. Sensitivity: USD 0.0100–0.0500/min.

## 2. Rate card: SMS

| Meter                             | Twilio USD | Twilio AUD |  Plivo USD | Plivo AUD | Cheaper |
| --------------------------------- | ---------: | ---------: | ---------: | --------: | ------- |
| Outbound SMS to AU, per segment   |     0.0515 |    0.07725 |   0.0473 ² | 0.07095 ² | Plivo   |
| Inbound SMS, per segment          |     0.0075 |    0.01125 |     0.0030 |    0.0045 | Plivo   |
| Outbound/inbound MMS              |     0.3500 |     0.5250 | Not listed |         — | —       |
| Alphanumeric sender ID rental     |       Free |       Free |   `VERIFY` |         — | —       |
| Failed-message processing fee     |     0.0010 |     0.0015 | Not listed |         — | —       |
| SMS pumping protection (optional) |     0.0250 |     0.0375 | Not listed |         — | —       |

² Plivo lists carrier-specific AU rates from USD 0.0451 to 0.0473 for the major networks
(Telstra 0.0459, Optus 0.0455, Vodafone 0.0456, default 0.0473), plus outliers ("Other
Networks" 0.3730; one Vodafone Hutchison route 0.6667). The scenarios use the default 0.0473.
Watch for traffic landing on the outlier routes.

## 3. Rate card: WhatsApp messaging and calling

| Meter                                              |                                     Twilio USD | Twilio AUD |  Plivo USD | Plivo AUD | Notes                                                   |
| -------------------------------------------------- | ---------------------------------------------: | ---------: | ---------: | --------: | ------------------------------------------------------- |
| Provider fee per message (in **and** out)          |                                         0.0050 |     0.0075 |     0.0010 |    0.0015 | Plivo "platform fee", effective 1 Nov 2026              |
| Provider monthly fee per WhatsApp Business Account |                                           0.00 |       0.00 |      10.00 |     15.00 | Plivo only                                              |
| Failed message fee                                 |                                         0.0010 |     0.0015 | Not listed |         — |                                                         |
| Meta marketing template (AU), per delivered msg    |                                         0.0842 |     0.1263 |     0.0842 |    0.1263 | Meta pass-through; Rest of APAC rate rose on 1 Oct 2026 |
| Meta utility template (AU)                         |                                         0.0113 |    0.01695 |     0.0113 |   0.01695 | Free inside an open 24 h window                         |
| Meta authentication template (AU)                  |                                         0.0113 |    0.01695 |     0.0113 |   0.01695 |                                                         |
| Meta service (free-form) messages                  | first 1,000/month per number free, then 0.0113 |    0.01695 |       same |      same | Meta change; `VERIFY`                                   |
| WhatsApp call, provider channel fee, per min       |                                         0.0050 |     0.0075 |   0.0040 ³ |  0.0060 ³ | Twilio in + out                                         |
| Meta call fee, user-initiated (AU)                 |                                         0.0000 |     0.0000 |     0.0000 |    0.0000 | All user-initiated calls are free                       |
| Meta call fee, business-initiated (AU), per min    |                                         0.0114 |     0.0171 |     0.0114 |    0.0171 | 6-second pulses, volume tiers                           |
| Agent leg (browser/SIP) answering a WhatsApp call  |                                         0.0040 |     0.0060 |   0.0033 ³ |  0.0050 ³ |                                                         |

³ **Plivo publishes WhatsApp calling rates for the US only** (inbound USD 0.0040/min, outbound
USD 0.0160/min). The AU figures here are an **estimate**: the US inbound channel rate, plus
Meta's AU business-initiated fee, plus the Plivo SDK leg. Get a written AU quote. Meta
fees: the AU template rates come from Plivo's AU page; confirm them against Meta's USD rate-card
CSV.

## 4. Cost per connected minute, by route

| Route                                                    | Twilio USD | Twilio AUD | Plivo USD | Plivo AUD | Plivo saves |
| -------------------------------------------------------- | ---------: | ---------: | --------: | --------: | ----------: |
| Inbound (mobile number) → AI agent via audio stream      |     0.0144 |     0.0216 |    0.0075 |    0.0113 |         48% |
| Inbound (mobile number) → AI agent via ConversationRelay |     0.0800 |     0.1200 |       n/a |       n/a |           — |
| Inbound → forwarded to staff AU mobile (2 legs)          |     0.0850 |     0.1275 |    0.0805 |    0.1208 |          5% |
| Inbound → staff browser/SIP (2 legs)                     |     0.0140 |     0.0210 |    0.0108 |    0.0162 |         23% |
| Browser → AU mobile customer (2 legs)                    |     0.0790 |     0.1185 |    0.0763 |    0.1145 |          3% |
| Browser → AU landline customer (2 legs)                  |     0.0292 |     0.0438 |    0.0263 |    0.0395 |         10% |
| WhatsApp inbound → browser agent                         |     0.0090 |     0.0135 |  0.0073 ³ |  0.0110 ³ |         19% |
| WhatsApp outbound → AU user, browser agent               |     0.0204 |     0.0306 |  0.0187 ³ |  0.0281 ³ |          8% |

The AI-agent rows exclude your own STT/LLM/TTS or speech-to-speech model cost, which is the same
whichever provider carries the call. ConversationRelay includes Twilio's STT/TTS, so compare it
against "stream + your speech stack", not against the stream alone. Add recording at USD
0.0025/min on Twilio (free on Plivo) for recorded routes.

**Route choice beats provider choice:** answering in the browser instead of forwarding to a
staff mobile costs **USD 0.0140 vs 0.0850/min on Twilio**. Moving to Plivo saves at most
USD 0.0045/min on the same route.

## 5. Monthly scenarios

### Assumptions

One AU **mobile** business number (voice + SMS + WhatsApp sender), one WhatsApp Business
Account, AU customers only. AI agent answers first; some calls go to a staff mobile; staff
place outbound calls from the browser. All human-handled minutes are recorded; Twilio
recording storage reserves one month. "WhatsApp messages" is sent plus received. Half are
outbound; of the outbound, utility templates are sent outside the window and the rest are
free-form service messages (first 1,000/month free). No marketing templates, no MMS, no
international traffic, no AI model costs.

| Quantity per month                           |  Pilot | Regular |      Busy |
| -------------------------------------------- | -----: | ------: | --------: |
| Inbound minutes handled by AI agent (stream) |    150 |     750 |     3,750 |
| Inbound minutes forwarded to staff mobile    |    100 |     500 |     2,500 |
| Outbound browser → AU mobile minutes         |    100 |     500 |     2,000 |
| Recorded minutes (staff + outbound)          |    200 |   1,000 |     4,500 |
| Outbound SMS segments                        |    500 |   2,500 |    10,000 |
| Inbound SMS segments                         |    200 |   1,000 |     4,000 |
| WhatsApp messages (in + out)                 |  1,000 |   5,000 |    20,000 |
| Utility templates outside the window         |    100 |     500 |     2,000 |
| Service messages charged (over 1,000 free)   |      0 |   1,000 |     7,000 |
| WhatsApp call minutes inbound / outbound     | 100/20 | 600/100 | 2,400/600 |

### Pilot (USD and AUD, ex GST)

| Line                                        | Twilio USD |       Plivo USD | Twilio AUD | Plivo AUD |
| ------------------------------------------- | ---------: | --------------: | ---------: | --------: |
| Mobile number rental                        |       8.25 |            5.00 |      12.38 |      7.50 |
| AI agent inbound (number + stream)          |       2.16 |            1.13 |       3.24 |      1.69 |
| Inbound forwarded to staff mobile (2 legs)  |       8.50 |            8.05 |      12.75 |     12.08 |
| Browser → AU mobile (2 legs)                |       7.90 |            7.63 |      11.85 |     11.45 |
| Call recording + storage                    |       0.60 |            0.00 |       0.90 |      0.00 |
| SMS outbound                                |      25.75 |           23.65 |      38.63 |     35.48 |
| SMS inbound                                 |       1.50 |            0.60 |       2.25 |      0.90 |
| WhatsApp provider message fees              |       5.00 |            1.00 |       7.50 |      1.50 |
| WhatsApp monthly WABA fee                   |       0.00 |           10.00 |       0.00 |     15.00 |
| WhatsApp calls (channel + Meta + agent leg) |       1.31 |            1.10 |       1.96 |      1.66 |
| Meta templates + service messages           |       1.13 |            1.13 |       1.70 |      1.70 |
| **Total**                                   |  **62.10** |       **59.29** |  **93.15** | **88.93** |
| Plivo saving                                |            | **2.81 (4.5%)** |            |  **4.21** |

### Regular

| Line                                        | Twilio USD |         Plivo USD | Twilio AUD |  Plivo AUD |
| ------------------------------------------- | ---------: | ----------------: | ---------: | ---------: |
| Mobile number rental                        |       8.25 |              5.00 |      12.38 |       7.50 |
| AI agent inbound (number + stream)          |      10.80 |              5.63 |      16.20 |       8.44 |
| Inbound forwarded to staff mobile (2 legs)  |      42.50 |             40.25 |      63.75 |      60.38 |
| Browser → AU mobile (2 legs)                |      39.50 |             38.15 |      59.25 |      57.23 |
| Call recording + storage                    |       3.00 |              0.00 |       4.50 |       0.00 |
| SMS outbound                                |     128.75 |            118.25 |     193.13 |     177.38 |
| SMS inbound                                 |       7.50 |              3.00 |      11.25 |       4.50 |
| WhatsApp provider message fees              |      25.00 |              5.00 |      37.50 |       7.50 |
| WhatsApp monthly WABA fee                   |       0.00 |             10.00 |       0.00 |      15.00 |
| WhatsApp calls (channel + Meta + agent leg) |       7.44 |              6.25 |      11.16 |       9.38 |
| Meta templates + service messages           |      16.95 |             16.95 |      25.43 |      25.43 |
| **Total**                                   | **289.69** |        **248.47** | **434.53** | **372.71** |
| Plivo saving                                |            | **41.21 (14.2%)** |            |  **61.82** |

### Busy

| Line                                        |   Twilio USD |          Plivo USD |   Twilio AUD |    Plivo AUD |
| ------------------------------------------- | -----------: | -----------------: | -----------: | -----------: |
| Mobile number rental                        |         8.25 |               5.00 |        12.38 |         7.50 |
| AI agent inbound (number + stream)          |        54.00 |              28.13 |        81.00 |        42.19 |
| Inbound forwarded to staff mobile (2 legs)  |       212.50 |             201.25 |       318.75 |       301.88 |
| Browser → AU mobile (2 legs)                |       158.00 |             152.60 |       237.00 |       228.90 |
| Call recording + storage                    |        13.50 |               0.00 |        20.25 |         0.00 |
| SMS outbound                                |       515.00 |             473.00 |       772.50 |       709.50 |
| SMS inbound                                 |        30.00 |              12.00 |        45.00 |        18.00 |
| WhatsApp provider message fees              |       100.00 |              20.00 |       150.00 |        30.00 |
| WhatsApp monthly WABA fee                   |         0.00 |              10.00 |         0.00 |        15.00 |
| WhatsApp calls (channel + Meta + agent leg) |        33.84 |              28.74 |        50.76 |        43.11 |
| Meta templates + service messages           |       101.70 |             101.70 |       152.55 |       152.55 |
| **Total**                                   | **1,226.79** |       **1,032.41** | **1,840.18** | **1,548.62** |
| Plivo saving                                |              | **194.37 (15.8%)** |              |   **291.56** |

Line items are rounded to cents; totals are computed from unrounded values.

### If Twilio keeps ConversationRelay for the AI agent

Replacing Media Streams with ConversationRelay on the AI-agent minutes adds
**USD 9.84 / 49.20 / 246.00** (AUD 14.76 / 73.80 / 369.00) for pilot / regular / busy. Twilio
totals become **USD 71.94 / 338.89 / 1,472.79** (AUD 107.91 / 508.33 / 2,209.18). This is
partly offset by not paying for your own STT/TTS. Plivo has no managed equivalent, so moving to
Plivo also means running your own speech stack.

## 6. What the numbers mean

1. **SMS is the largest line at every volume.** Plivo's SMS saving (about 8% outbound, 60%
   inbound) is the biggest absolute saving. Check which AU carrier routes your traffic
   lands on; Plivo's outlier routes cost far more.
2. **WhatsApp provider fees favour Plivo above roughly 2,500 messages per month.** Plivo's
   USD 10 monthly fee breaks even with Twilio's higher per-message fee at
   `10 / (0.005 − 0.001) = 2,500` messages. Below that, Twilio is cheaper on WhatsApp.
3. **Recording and AI streaming are free on Plivo.** That matters if every call is recorded
   or AI-handled.
4. **PSTN minutes are close (3–5%).** Routing (browser vs mobile forwarding) dominates.
5. **Meta fees are a fixed cost of WhatsApp.** No provider choice changes them. Keep
   templates inside the 24 h window where possible (utility templates are free there).
6. **One-off migration costs are not in the tables:** new number compliance, possible number
   porting fees, WhatsApp sender re-registration, template re-approval and engineering
   time. At regular volume the saving is about **USD 41 / AUD 62 per month**. Weigh that
   against the migration effort in [file 05](./05-testing-migration-checklist.md#3-migration-plan-twilio-to-plivo).

## 7. Re-pricing checklist (run before any quote)

- [ ] Re-read every page listed in the [README sources](./README.md#sources-read-on-the-research-date).
- [ ] Get Twilio's console rate card for AU mobile inbound and rental (resolves the page
      contradiction).
- [ ] Get Plivo's written AU WhatsApp calling rate (inbound, outbound, agent leg).
- [ ] Download Meta's current USD rate card CSV and confirm the Rest of Asia Pacific rows:
      marketing, utility, authentication, service and calling.
- [ ] Confirm the GST treatment with each provider for your billing entity.
- [ ] Update the FX rate and recompute AUD columns: `AUD = USD × rate`.
