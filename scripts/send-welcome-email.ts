import 'dotenv/config';

import { render } from '@react-email/components';
import WelcomeEmail from '../lib/graph/Email/welcome-email';
import { createGraphContext } from '../lib/graph/client';
import { getGraphConfig } from '../lib/graph/config';
import { RC_URLS } from '../lib/graph/Email/email-theme';

const to = process.argv[2] ?? 'dhrubjyoti.biswas@gmail.com';
const name = process.argv[3] ?? 'Dhrubjyoti';

async function main() {
  const bookingUrl = `${RC_URLS.bookConsultation}?${new URLSearchParams({
    name,
    email: to,
  }).toString()}`;

  const html = await render(
    WelcomeEmail({ name, bookingUrl }),
    { pretty: true },
  );

  if (!html) {
    throw new Error('Failed to render welcome email HTML');
  }

  const subject =
    'Welcome to Royal Constructions - Book Your Builder Appointment';

  const config = getGraphConfig();
  const client = await createGraphContext(config);

  await client.sendMail({ to, subject, body: html });

  console.log(`Welcome email sent to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
