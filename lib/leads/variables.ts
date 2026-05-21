import { EmailTemplate } from './types';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 1,
    subject: 'Welcome to BuildPro - Your Home Building Journey Starts Here',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 34px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Welcome to Royal Constructions — Your Home Building Journey Starts Here
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- Logo Header with Light Background -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Hero Section -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10 mobile_pb-8" style="padding:4rem 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <table align="left" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_max-w-full" style="max-width:490px;">
                            <tbody>
                              <tr>
                                <td>
                                  <p class="mobile_font-40" style='font-size:52px;line-height:1;letter-spacing:-1.5px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                                    Welcome to<br/>Royal Constructions
                                  </p>
                                  <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:2.5rem 0 0 0;max-width:490px;font-family:Inter,Arial,sans-serif;">
                                    Dear {name}, thank you for choosing Royal Constructions for your home building project in NSW. We're excited to partner with you on this journey to bring your dream home to life.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Hero Image -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <img alt="Luxury Home by Royal Constructions" src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=592&h=340&fit=crop&auto=format" style="display:block;outline:none;border:none;text-decoration:none;width:100%;max-width:592px;border-radius:4px;" width="592" />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- What Happens Next -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:4rem 1.5rem 0 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:32px;line-height:0.9;letter-spacing:0.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 2.5rem 0;text-transform:uppercase;'>
                            What happens next
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Step 1 -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_py-8" style="padding:0 1.5rem;border-bottom:1px solid #1A2A42;padding-bottom:2.5rem;padding-top:2.5rem;">
                    <tbody>
                      <tr>
                        <td width="44" valign="top" style="padding-top:3px;">
                          <p style='font-size:22px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>01</p>
                        </td>
                        <td style="padding-left:0.75rem;">
                          <p style='font-size:18px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                            Schedule a Consultation
                          </p>
                          <p style="font-size:14px;line-height:1.6;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            We'll arrange a detailed on-site consultation to understand your vision, lifestyle needs, and design preferences.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Step 2 -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_py-8" style="padding:0 1.5rem;border-bottom:1px solid #1A2A42;padding-bottom:2.5rem;padding-top:2.5rem;">
                    <tbody>
                      <tr>
                        <td width="44" valign="top" style="padding-top:3px;">
                          <p style='font-size:22px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>02</p>
                        </td>
                        <td style="padding-left:0.75rem;">
                          <p style='font-size:18px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                            Receive Your Quotation
                          </p>
                          <p style="font-size:14px;line-height:1.6;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Our team will prepare a comprehensive, transparent quotation tailored specifically to your project scope and budget.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Step 3 -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_py-8" style="padding:0 1.5rem;padding-bottom:2.5rem;padding-top:2.5rem;">
                    <tbody>
                      <tr>
                        <td width="44" valign="top" style="padding-top:3px;">
                          <p style='font-size:22px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>03</p>
                        </td>
                        <td style="padding-left:0.75rem;">
                          <p style='font-size:18px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                            Access Your Client Portal
                          </p>
                          <p style="font-size:14px;line-height:1.6;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            You'll receive login details to track progress, view updates, and communicate with our team in real time.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- 24 Hour Notice -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0.5rem 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#C9A84C;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Our team will be in touch within 24 hours to arrange your first consultation.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Get Started Section -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pb-10" style="padding:0 1.5rem 3.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:32px;line-height:0.9;letter-spacing:0.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;text-transform:uppercase;'>
                            Get started
                          </p>

                          <!-- Card 1 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_py-8" style="border-bottom:1px solid #1A2A42;padding:2.5rem 0;">
                            <tbody>
                              <tr>
                                <td>
                                  <p style='font-size:20px;line-height:1.1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.75rem 0;'>
                                    Book Your Consultation
                                  </p>
                                  <p style="font-size:14px;line-height:1.6;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                    Take the first step—schedule your initial consultation with our building experts.
                                  </p>
                                  <a href="https://royalconstructions.com.au/contact/" style="color:#C9A84C;text-decoration:none;font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;font-family:Inter,Arial,sans-serif;" target="_blank">Book Now&nbsp;→</a>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Card 2 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_py-8" style="padding:2.5rem 0;">
                            <tbody>
                              <tr>
                                <td>
                                  <p style='font-size:20px;line-height:1.1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.75rem 0;'>
                                    Explore Our Portfolio
                                  </p>
                                  <p style="font-size:14px;line-height:1.6;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                    Browse our completed projects across NSW for inspiration and ideas for your new home.
                                  </p>
                                  <a href="https://royalconstructions.com.au/" style="color:#C9A84C;text-decoration:none;font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;font-family:Inter,Arial,sans-serif;" target="_blank">View Projects&nbsp;→</a>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Need Help -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="padding-top:2.5rem;">
                            <tbody>
                              <tr>
                                <td>
                                  <p style="font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;color:#FFFFFF;margin:0 0 0.125rem 0;font-family:Inter,Arial,sans-serif;">
                                    Questions?
                                  </p>
                                  <p class="mobile_max-w-full" style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#B8C4D6;margin:0;max-width:490px;font-family:Inter,Arial,sans-serif;">
                                    Our team is here to help. Reach out at
                                    <a href="mailto:info@royalconstructions.com.au" style="color:#C9A84C;text-decoration:none;">info@royalconstructions.com.au</a>
                                    or call
                                    <a href="tel:1300832355" style="color:#C9A84C;text-decoration:none;">1300 832 355</a>.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Sign-off -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.5rem 0;font-family:Inter,Arial,sans-serif;">
                            We look forward to building something extraordinary with you.
                          </p>
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Warm regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ==================== FOOTER ==================== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <!-- Two Column Footer -->
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- ===== LEFT COLUMN ===== -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- ===== RIGHT COLUMN — ACCREDITED BY ===== -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ==================== END FOOTER ==================== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Welcome',
    body: `Dear {name},

Thank you for choosing BuildPro for your home building project in NSW. We are excited to partner with you on this journey.

Here is what happens next:
1. We will schedule a detailed consultation to understand your requirements
2. Our team will prepare a personalized quotation
3. You will receive access to our client portal for real-time updates

Our team will be in touch within 24 hours to arrange your first consultation.

Warm regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 2,
    subject: 'Your Personalized Quotation - {project}',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
      .mobile_summary_full { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Your Personalized Quotation — Review your project details and approve to get started
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO — Quotation Title ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10 mobile_pb-8" style="padding:3.5rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Quotation
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 1.5rem 0;text-transform:uppercase;'>
                            Your Personalized<br/>Quotation
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:460px;font-family:Inter,Arial,sans-serif;">
                            Dear {name}, please find below your personalized quotation for <span style="color:#FFFFFF;font-weight:450;">{project}</span> at <span style="color:#FFFFFF;font-weight:450;">{location}</span>.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== QUOTE SUMMARY CARD ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">

                            <!-- Card Header -->
                            <tr>
                              <td style="background-color:#C9A84C;padding:0.875rem 1.5rem;">
                                <p style='font-size:13px;line-height:1;letter-spacing:0.6px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;'>
                                  Quote Summary
                                </p>
                              </td>
                            </tr>

                            <!-- Row 1 — Project Type -->
                            <tr>
                              <td style="padding:1rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:top;width:40%;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Project Type
                                      </p>
                                    </td>
                                    <td style="vertical-align:top;padding-left:1rem;">
                                      <p style="font-size:14px;line-height:1.4;letter-spacing:0.2px;font-weight:450;color:#FFFFFF;margin:0;font-family:Inter,Arial,sans-serif;">
                                        {type}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 2 — Total Cost -->
                            <tr>
                              <td style="padding:1rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:top;width:40%;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Total Cost
                                      </p>
                                    </td>
                                    <td style="vertical-align:top;padding-left:1rem;">
                                      <p style='font-size:22px;line-height:1.1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>
                                        {amount}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 3 — Estimated Duration -->
                            <tr>
                              <td style="padding:1rem 1.5rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:top;width:40%;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Estimated Duration
                                      </p>
                                    </td>
                                    <td style="vertical-align:top;padding-left:1rem;">
                                      <p style="font-size:14px;line-height:1.4;letter-spacing:0.2px;font-weight:450;color:#FFFFFF;margin:0;font-family:Inter,Arial,sans-serif;">
                                        {duration}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HOW TO PROCEED ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:1rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:28px;line-height:0.9;letter-spacing:0.3px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 2rem 0;text-transform:uppercase;'>
                            How to proceed
                          </p>

                          <!-- Step 1 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="40" valign="top" style="padding-top:2px;">
                                  <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:28px;height:28px;background-color:#C9A84C;border-radius:50%;">
                                    <tr>
                                      <td style="text-align:center;vertical-align:middle;">
                                        <p style='font-size:13px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;'>1</p>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Review Your Quotation
                                  </p>
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Carefully review all project details, specifications, and costs outlined in the attached quotation document.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Step 2 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="40" valign="top" style="padding-top:2px;">
                                  <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:28px;height:28px;background-color:#C9A84C;border-radius:50%;">
                                    <tr>
                                      <td style="text-align:center;vertical-align:middle;">
                                        <p style='font-size:13px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;'>2</p>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Approve the Quote
                                  </p>
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Click the <span style="color:#C9A84C;font-weight:450;">APPROVE</span> button below to confirm your acceptance and move forward.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Step 3 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="padding-bottom:0;">
                            <tbody>
                              <tr>
                                <td width="40" valign="top" style="padding-top:2px;">
                                  <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:28px;height:28px;background-color:#C9A84C;border-radius:50%;">
                                    <tr>
                                      <td style="text-align:center;vertical-align:middle;">
                                        <p style='font-size:13px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;'>3</p>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Upload Signed Copy
                                  </p>
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:350;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Upload the signed quotation using the link provided after approval to finalize your project.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== APPROVE CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/approve-quote/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 3rem;'>
                                    Approve Quotation
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== VALIDITY NOTICE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#C9A84C;margin:0;font-family:Inter,Arial,sans-serif;">
                                    This quotation is valid for <span style="color:#FFFFFF;font-weight:500;">14 days</span> from the date of this email. Please ensure approval within this period to lock in your pricing.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== QUESTIONS ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Questions about your quote?
                          </p>
                          <p class="mobile_max-w-full" style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#B8C4D6;margin:0;max-width:490px;font-family:Inter,Arial,sans-serif;">
                            Reach out at
                            <a href="mailto:info@royalconstructions.com.au" style="color:#C9A84C;text-decoration:none;">info@royalconstructions.com.au</a>
                            or call
                            <a href="tel:1300832355" style="color:#C9A84C;text-decoration:none;">1300 832 355</a>.
                            We're happy to walk through any details.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Kind regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Quotation',
    body: `Dear {name},

Please find attached your personalized quotation for {project} at {location}.

Quote Summary:
- Project Type: {type}
- Total Cost: {amount}
- Estimated Duration: {duration}

To proceed, please:
1. Review the attached quotation
2. Click the APPROVE button in the email
3. Upload the signed copy using the upload link

This quote is valid for 14 days from the date of this email.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 3,
    subject: 'Follow-up: Next Steps for Your {type} Project',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Following up on your project — let's take the next step together
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO — Follow-up Title ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:3.5rem 1.5rem 2rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Follow-up
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                            Let's Keep the<br/>Momentum Going
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== PERSONAL MESSAGE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0.5rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Dear {name},
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            I wanted to follow up on our recent conversation regarding your <span style="color:#FFFFFF;font-weight:450;">{type}</span> project at <span style="color:#FFFFFF;font-weight:450;">{location}</span>. It was great connecting with you and learning more about your vision.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== DISCUSSION NOTES CARD ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">

                            <!-- Card Header -->
                            <tr>
                              <td style="padding:1rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="24" valign="middle" style="padding-right:0.625rem;">
                                      <!-- Chat bubble icon -->
                                      <img alt="" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'%3E%3C/path%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="18" />
                                    </td>
                                    <td valign="middle">
                                      <p style='font-size:12px;line-height:1;letter-spacing:0.8px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;text-transform:uppercase;'>
                                        What we discussed
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Notes Content -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;">
                                <p style="font-size:14px;line-height:1.7;letter-spacing:0.2px;font-weight:350;color:#D0DAE8;margin:0;font-family:Inter,Arial,sans-serif;">
                                  {notes}
                                </p>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== NEXT STEPS — Quick Call CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.5rem 0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            I'd love to answer any questions you might have and help move things forward. Would you be available for a quick call this week?
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SCHEDULE CALL BUTTON ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 1.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/schedule-call/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 2.5rem;'>
                                    Schedule a Call
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== ALTERNATIVE — OR REACH OUT DIRECTLY ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <p style="font-size:12px;line-height:1.5;letter-spacing:0.4px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Or reach out directly
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== CONTACT CARDS ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <!-- Phone Card -->
                              <td style="width:48%;vertical-align:top;padding-right:4%;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;text-align:center;">
                                      <!-- Phone Icon -->
                                      <img alt="" height="24" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'%3E%3C/path%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto 0.75rem auto;" width="24" />
                                      <p style="font-size:11px;line-height:1;letter-spacing:0.6px;font-weight:500;color:#6B7F9E;margin:0 0 0.5rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Call us
                                      </p>
                                      <a href="tel:1300832355" style='font-size:15px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;text-decoration:none;'>
                                        1300 832 355
                                      </a>
                                    </td>
                                  </tr>
                                </table>
                              </td>

                              <!-- Email Card -->
                              <td style="width:48%;vertical-align:top;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;text-align:center;">
                                      <!-- Mail Icon -->
                                      <img alt="" height="24" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'%3E%3C/path%3E%3Cpolyline points='22,6 12,13 2,6'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto 0.75rem auto;" width="24" />
                                      <p style="font-size:11px;line-height:1;letter-spacing:0.6px;font-weight:500;color:#6B7F9E;margin:0 0 0.5rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Email us
                                      </p>
                                      <a href="mailto:info@royalconstructions.com.au" style='font-size:13px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;text-decoration:none;'>
                                        info@royalconstructions.com.au
                                      </a>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== ENCOURAGEMENT NOTE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Building a home is a big decision — there's <span style="color:#C9A84C;font-weight:450;">no rush</span> and <span style="color:#C9A84C;font-weight:450;">no pressure</span>. We're here whenever you're ready to take the next step.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Best regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Follow-up',
    body: `Dear {name},

I wanted to follow up on our recent conversation regarding your {type} project at {location}.

During our last call, we discussed:
{notes}

I would love to answer any questions you might have and help move things forward. Would you be available for a quick call this week?

Best regards,
Guri Singh
BuildPro NSW
{phone}`,
  },
  {
    id: 4,
    subject: 'Material Catalogue - Choose Your Finishes',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Explore our material catalogue and choose your preferred finishes
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO — Catalogue Title ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:3.5rem 1.5rem 2rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Material Catalogue
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                            Curate Your<br/>Space
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO IMAGE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <img alt="Premium home finishes and materials" src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=5https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=592&h=280&fit=crop&auto=format92&h=280&fit=crop&auto=format" style="display:block;outline:none;border:none;text-decoration:none;width:100%;max-width:592px;border-radius:4px;" width="592" />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== INTRO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Dear {name},
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            As discussed, it's time to bring your vision to life. Explore our curated material catalogue below and select the premium finishes that will make your house truly feel like home.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== CATEGORY LIST ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:28px;line-height:0.9;letter-spacing:0.3px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 2rem 0;text-transform:uppercase;'>
                            Selection Categories
                          </p>

                          <!-- Category 1 — Bricks & External Cladding -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="44" valign="top" style="padding-top:2px;">
                                  <img alt="" height="26" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='1' y='3' width='15' height='13'%3E%3C/rect%3E%3Cpolygon points='16 8 20 8 23 11 23 16 16 16 16 8'%3E%3C/polygon%3E%3Ccircle cx='5.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3Ccircle cx='18.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="26" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Bricks &amp; External Cladding
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Define the exterior character and street appeal of your new home.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Category 2 — Slab & Foundation Options -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="44" valign="top" style="padding-top:2px;">
                                  <img alt="" height="26" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='3' y1='9' x2='21' y2='9'%3E%3C/line%3E%3Cline x1='9' y1='21' x2='9' y2='9'%3E%3C/line%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="26" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Slab &amp; Foundation Options
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0;font-family:Inter,Arial,sans-serif;">
                                    The structural backbone — ensure lasting quality from the ground up.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Category 3 — Roofing Materials -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="44" valign="top" style="padding-top:2px;">
                                  <img alt="" height="26" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'%3E%3C/path%3E%3Cpolyline points='9 22 9 12 15 12 15 22'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="26" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Roofing Materials
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Protect and crown your home with premium, durable roofing.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Category 4 — Internal Fixtures & Fittings -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.75rem;margin-bottom:1.75rem;">
                            <tbody>
                              <tr>
                                <td width="44" valign="top" style="padding-top:2px;">
                                  <img alt="" height="26" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='5'%3E%3C/circle%3E%3Cline x1='12' y1='1' x2='12' y2='3'%3E%3C/line%3E%3Cline x1='12' y1='21' x2='12' y2='23'%3E%3C/line%3E%3Cline x1='4.22' y1='4.22' x2='5.64' y2='5.64'%3E%3C/line%3E%3Cline x1='18.36' y1='18.36' x2='19.78' y2='19.78'%3E%3C/line%3E%3Cline x1='1' y1='12' x2='3' y2='12'%3E%3C/line%3E%3Cline x1='21' y1='12' x2='23' y2='12'%3E%3C/line%3E%3Cline x1='4.22' y1='19.78' x2='5.64' y2='18.36'%3E%3C/line%3E%3Cline x1='18.36' y1='5.64' x2='19.78' y2='4.22'%3E%3C/line%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="26" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Internal Fixtures &amp; Fittings
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0;font-family:Inter,Arial,sans-serif;">
                                    The finishing touches that complete every room with style.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Category 5 — Kitchen & Bathroom Selections -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="padding-bottom:0;">
                            <tbody>
                              <tr>
                                <td width="44" valign="top" style="padding-top:2px;">
                                  <img alt="" height="26" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 8h1a4 4 0 0 1 0 8h-1'%3E%3C/path%3E%3Cpath d='M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z'%3E%3C/path%3E%3Cline x1='6' y1='1' x2='6' y2='4'%3E%3C/line%3E%3Cline x1='10' y1='1' x2='10' y2='4'%3E%3C/line%3E%3Cline x1='14' y1='1' x2='14' y2='4'%3E%3C/line%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="26" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                    Kitchen &amp; Bathroom Selections
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Choose the heart and sanctuary of your home — benchtops, tapware, and more.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== BROWSE CATALOGUE CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:2rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/catalogue/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 2.5rem;'>
                                    Browse Catalogue
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== VARIATION NOTICE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Selecting premium finishes may apply variations to your quotation. We'll notify you of any <span style="color:#C9A84C;font-weight:450;">cost adjustments</span> before finalizing your selections.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Kind regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Catalogue',
    body: `Dear {name},

As discussed, please find below the link to our material catalogue where you can select your preferred finishes:

- Bricks and External Cladding
- Slab and Foundation Options
- Roofing Materials
- Internal Fixtures and Fittings
- Kitchen and Bathroom Selections

Please make your selections and we will update your quotation if any variations apply.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 5,
    subject: 'Variation Quote - {project} Update',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
      .mobile_amount_stack { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; text-align: left !important; }
      .mobile_arrow_hide { display: none !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Your quotation has been updated — review the variation and approve to proceed
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO — Variation Title ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:3.5rem 1.5rem 2rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Variation
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                            Quotation<br/>Update
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== INTRO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Dear {name},
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            Following your recent selections from our catalogue, there are some variations to the original quotation for <span style="color:#FFFFFF;font-weight:450;">{project}</span>. Please review the updated breakdown below.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== VARIATION COMPARISON CARD ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">

                            <!-- Card Header -->
                            <tr>
                              <td style="background-color:#C9A84C;padding:0.875rem 1.5rem;">
                                <p style='font-size:13px;line-height:1;letter-spacing:0.6px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;'>
                                  Variation Summary
                                </p>
                              </td>
                            </tr>

                            <!-- Row 1 — Original Quote -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:middle;width:50%;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Original Quote
                                      </p>
                                    </td>
                                    <td class="mobile_amount_stack" style="vertical-align:middle;text-align:right;">
                                      <p style='font-size:18px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#B8C4D6;margin:0;text-decoration:line-through;text-decoration-color:#6B7F9E;'>
                                        {originalAmount}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 2 — Variation Amount -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;border-bottom:1px solid #1A2A42;background-color:#111D30;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:middle;width:50%;">
                                      <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                                        <tr>
                                          <td valign="middle" style="padding-right:0.5rem;">
                                            <img alt="" height="16" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='23 6 13.5 15.5 8.5 10.5 1 18'%3E%3C/polyline%3E%3Cpolyline points='17 6 23 6 23 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="16" />
                                          </td>
                                          <td valign="middle">
                                            <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#C9A84C;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                              Variation
                                            </p>
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                    <td class="mobile_amount_stack" style="vertical-align:middle;text-align:right;">
                                      <p style='font-size:20px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;'>
                                        + {variationAmount}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 3 — Revised Total -->
                            <tr>
                              <td style="padding:1.5rem;border-bottom:none;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td style="vertical-align:middle;width:50%;">
                                      <p style="font-size:13px;line-height:1.4;letter-spacing:0.3px;font-weight:450;color:#FFFFFF;margin:0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Revised Total
                                      </p>
                                    </td>
                                    <td class="mobile_amount_stack" style="vertical-align:middle;text-align:right;">
                                      <p style='font-size:28px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {revisedAmount}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== WHAT CHANGED ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    This variation reflects your recent material and finish selections. As always, we're happy to <span style="color:#C9A84C;font-weight:450;">walk you through</span> any changes in detail.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== APPROVE CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/approve-variation/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 3rem;'>
                                    Approve Variation
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGNED COPY NOTICE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <p style="font-size:12px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0;font-family:Inter,Arial,sans-serif;">
                            A signed copy of the updated quotation is required to proceed with your project.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Kind regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Variation',
    body: `Dear {name},

Following your recent selections from our catalogue, there are some variations to the original quotation for {project}.

Variation Summary:
- Original Quote: {originalAmount}
- Variation Amount: {variationAmount}
- Revised Total: {revisedAmount}

Please review and approve by clicking the button below. As before, a signed copy is required.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 6,
    subject: 'Special Offer - Exclusive Discount for BuildPro Clients',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 28px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_font-56 { font-size: 40px !important; line-height: 1 !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
      .mobile_offer_stack { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; padding-bottom: 1rem !important; }
      .mobile_offer_last { padding-bottom: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Exclusive upgrade package — confirm within 7 days to claim your offer
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== GOLD ACCENT BAR ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tbody>
                      <tr>
                        <td style="background-color:#C9A84C;height:3px;font-size:1px;line-height:1px;">&nbsp;</td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:3rem 1.5rem 0 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <p style="font-size:11px;line-height:1;letter-spacing:1.5px;font-weight:500;color:#C9A84C;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Exclusive Offer
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 1.5rem 0;text-transform:uppercase;'>
                            Your Dream Home,<br/>Elevated
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 auto;max-width:440px;font-family:Inter,Arial,sans-serif;">
                            Dear {name}, as a valued Royal Constructions client, we're thrilled to offer you an exclusive upgrade package — on us.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== BIG SAVINGS CALLOUT ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:2.5rem 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;background-color:#0F1E33;border:1px solid #1A2A42;border-radius:8px;">
                            <tbody>
                              <tr>
                                <td style="padding:2rem 3rem;text-align:center;">
                                  <p style="font-size:11px;line-height:1;letter-spacing:1px;font-weight:500;color:#6B7F9E;margin:0 0 0.75rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                    You could save up to
                                  </p>
                                  <p class="mobile_font-56" style='font-size:56px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;letter-spacing:-1px;'>
                                    $8,500
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== 3 OFFER CARDS ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- Offer 1 — Kitchen Upgrade -->
                              <td class="mobile_offer_stack" style="width:33.33%;vertical-align:top;padding-right:0.5rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;height:100%;">
                                  <tr>
                                    <td style="padding:1.5rem 1rem;text-align:center;">
                                      <!-- Star/Gift Icon -->
                                      <img alt="" height="32" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'%3E%3C/polygon%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto 0.875rem auto;" width="32" />
                                      <p style='font-size:13px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                                        FREE Premium<br/>Kitchen Upgrade
                                      </p>
                                      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                        <tbody>
                                          <tr>
                                            <td style="background-color:#C9A84C;border-radius:3px;">
                                              <p style='font-size:11px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;padding:0.25rem 0.5rem;text-transform:uppercase;letter-spacing:0.5px;'>
                                                Value $8,500
                                              </p>
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>

                              <!-- Offer 2 — Landscaping -->
                              <td class="mobile_offer_stack" style="width:33.33%;vertical-align:top;padding-left:0.25rem;padding-right:0.25rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;height:100%;">
                                  <tr>
                                    <td style="padding:1.5rem 1rem;text-align:center;">
                                      <!-- Tree/Leaf Icon -->
                                      <img alt="" height="32" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 8c.7-1 1-2.2 1-3.5C18 2.5 16.5 1 14.5 1c-1 0-1.8.4-2.5 1C11.3 1.4 10.5 1 9.5 1 7.5 1 6 2.5 6 4.5 6 5.8 6.3 7 7 8'%3E%3C/path%3E%3Cpath d='M12 2v20'%3E%3C/path%3E%3Cpath d='M7 8h10l-5 8-5-8z'%3E%3C/path%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto 0.875rem auto;" width="32" />
                                      <p style='font-size:13px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                                        Complimentary<br/>Landscaping Consult
                                      </p>
                                      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                        <tbody>
                                          <tr>
                                            <td style="background-color:#1A2A42;border-radius:3px;border:1px solid #2A3E5C;">
                                              <p style='font-size:11px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;padding:0.25rem 0.5rem;text-transform:uppercase;letter-spacing:0.5px;'>
                                                Free
                                              </p>
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>

                              <!-- Offer 3 — Priority Scheduling -->
                              <td class="mobile_offer_stack mobile_offer_last" style="width:33.33%;vertical-align:top;padding-left:0.5rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;height:100%;">
                                  <tr>
                                    <td style="padding:1.5rem 1rem;text-align:center;">
                                      <!-- Clock Icon -->
                                      <img alt="" height="32" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto 0.875rem auto;" width="32" />
                                      <p style='font-size:13px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.5rem 0;'>
                                        Priority<br/>Scheduling
                                      </p>
                                      <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                        <tbody>
                                          <tr>
                                            <td style="background-color:#1A2A42;border-radius:3px;border:1px solid #2A3E5C;">
                                              <p style='font-size:11px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0;padding:0.25rem 0.5rem;text-transform:uppercase;letter-spacing:0.5px;'>
                                                Fast-Track
                                              </p>
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>

                            </tr>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== URGENCY BAR — 7 DAYS ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#C9A84C;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1.25rem 1.5rem;text-align:center;">
                                  <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                    <tbody>
                                      <tr>
                                        <td valign="middle" style="padding-right:0.75rem;">
                                          <img alt="" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="20" />
                                        </td>
                                        <td valign="middle">
                                          <p style='font-size:14px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;letter-spacing:0.8px;'>
                                            Confirm within 7 days to unlock this offer
                                          </p>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0.5rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.75rem 0;font-family:Inter,Arial,sans-serif;">
                            Let's discuss how we can make your dream home even better.
                          </p>
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/claim-offer/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 3rem;'>
                                    Claim Your Offer
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== TERMS LINE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                            Offer valid for new confirmations only. Kitchen upgrade applies to selected ranges. <a href="https://royalconstructions.com.au/terms/" style="color:#3D5070;text-decoration:underline;" target="_blank">Full terms &amp; conditions</a>.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Warm regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Promotion',
    body: `Dear {name},

As a valued BuildPro enquiry, we are pleased to offer you an exclusive upgrade package:

- FREE premium kitchen upgrade (value $8,500)
- Complimentary landscaping consultation
- Priority scheduling for your project

This offer is available if you confirm within the next 7 days.

Let's discuss how we can make your dream home even better.

Warm regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 7,
    subject: 'Site Visit Confirmation - {location}',
    content:`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Your site visit is confirmed — review the details and what to expect
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:3.5rem 1.5rem 2rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Meeting Confirmation
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                            Site Visit<br/>Confirmed
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== INTRO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Dear {name},
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            This confirms your site visit has been scheduled. Please review the details below and ensure the site is accessible at the designated time.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== EVENT DETAILS CARD ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">

                            <!-- Card Header -->
                            <tr>
                              <td style="background-color:#C9A84C;padding:0.875rem 1.5rem;">
                                <p style='font-size:13px;line-height:1;letter-spacing:0.6px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;'>
                                  Appointment Details
                                </p>
                              </td>
                            </tr>

                            <!-- Row 1 — Date -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="36" valign="top" style="padding-top:2px;">
                                      <img alt="" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="20" />
                                    </td>
                                    <td style="padding-left:0.75rem;">
                                      <p style="font-size:11px;line-height:1.4;letter-spacing:0.4px;font-weight:300;color:#6B7F9E;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Date
                                      </p>
                                      <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {date}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 2 — Time -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="36" valign="top" style="padding-top:2px;">
                                      <img alt="" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="20" />
                                    </td>
                                    <td style="padding-left:0.75rem;">
                                      <p style="font-size:11px;line-height:1.4;letter-spacing:0.4px;font-weight:300;color:#6B7F9E;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Time
                                      </p>
                                      <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {time}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Row 3 — Location -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="36" valign="top" style="padding-top:2px;">
                                      <img alt="" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="20" />
                                    </td>
                                    <td style="padding-left:0.75rem;">
                                      <p style="font-size:11px;line-height:1.4;letter-spacing:0.4px;font-weight:300;color:#6B7F9E;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Location
                                      </p>
                                      <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {location}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== WHAT TO EXPECT ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:28px;line-height:0.9;letter-spacing:0.3px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 2rem 0;text-transform:uppercase;'>
                            What to expect
                          </p>

                          <!-- Item 1 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.5rem;margin-bottom:1.5rem;">
                            <tbody>
                              <tr>
                                <td width="36" valign="top" style="padding-top:2px;">
                                  <img alt="" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="18" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:15px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                    Site Assessment
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0.375rem 0 0 0;font-family:Inter,Arial,sans-serif;">
                                    Our team will evaluate the site conditions, topography, and any factors that may influence the build.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Item 2 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.5rem;margin-bottom:1.5rem;">
                            <tbody>
                              <tr>
                                <td width="36" valign="top" style="padding-top:2px;">
                                  <img alt="" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="18" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:15px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                    Measurement Taking
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0.375rem 0 0 0;font-family:Inter,Arial,sans-serif;">
                                    Precise measurements will be recorded to ensure accurate planning and quotation.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Item 3 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-bottom:1px solid #1A2A42;padding-bottom:1.5rem;margin-bottom:1.5rem;">
                            <tbody>
                              <tr>
                                <td width="36" valign="top" style="padding-top:2px;">
                                  <img alt="" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="18" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:15px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                    Initial Design Discussion
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0.375rem 0 0 0;font-family:Inter,Arial,sans-serif;">
                                    We'll discuss your layout preferences, must-haves, and design inspirations on-site.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Item 4 -->
                          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="padding-bottom:0;">
                            <tbody>
                              <tr>
                                <td width="36" valign="top" style="padding-top:2px;">
                                  <img alt="" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="18" />
                                </td>
                                <td style="padding-left:0.75rem;">
                                  <p style='font-size:15px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                    Q&amp;A Session
                                  </p>
                                  <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0.375rem 0 0 0;font-family:Inter,Arial,sans-serif;">
                                    An open floor to ask any questions about the build process, timelines, or next steps.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== ADD TO CALENDAR CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td style="background-color:#C9A84C;border-radius:4px;">
                                  <a href="https://royalconstructions.com.au/add-to-calendar/" target="_blank" style='display:inline-block;font-size:15px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;text-decoration:none;text-transform:uppercase;letter-spacing:1px;padding:1rem 2.5rem;'>
                                    Add to Calendar
                                  </a>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== IMPORTANT NOTICE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:400;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    Please ensure <span style="color:#FFFFFF;font-weight:450;">someone is available at the site</span> during the scheduled time so our team can conduct a thorough assessment.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== NEED TO RESCHEDULE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Need to reschedule?
                          </p>
                          <p class="mobile_max-w-full" style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#B8C4D6;margin:0;max-width:490px;font-family:Inter,Arial,sans-serif;">
                            No worries — simply reply to this email or call us at
                            <a href="tel:1300832355" style="color:#C9A84C;text-decoration:none;">1300 832 355</a>
                            and we'll find a time that works.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Kind regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Meeting',
    body: `Dear {name},

This confirms your site visit scheduled for:

Date: {date}
Time: {time}
Location: {location}

What to expect:
- Site assessment by our team
- Measurement taking
- Initial design discussion
- Q and A session

Please ensure someone is available at the site during the scheduled time.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 8,
    subject: 'Project Update - Milestone Completed at {location}',
    content: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta name="x-apple-disable-message-reformatting" />
  <style>
    @media (max-width:600px) {
      .mobile_max-w-full { max-width: 100% !important; }
      .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
      .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
      .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
      .mobile_pt-10 { padding-top: 2.5rem !important; }
      .mobile_pb-8 { padding-bottom: 2rem !important; }
      .mobile_pb-10 { padding-bottom: 2.5rem !important; }
      .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
      .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
      .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
      .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
      .mobile_progress_full { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; text-align: left !important; padding-bottom: 0.5rem !important; }
      .mobile_progress_last { padding-bottom: 0 !important; }
    }
  </style>
  <style>
    @font-face {
      font-family: 'IBM Plex Sans Condensed';
      font-style: normal;
      font-weight: 500;
      mso-font-alt: 'Arial';
      src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
    }
  </style>
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  </style>
</head>
<body style="background-color:#070E1A;margin:0;padding:0;">
  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
    <tbody>
      <tr>
        <td style="background-color:#070E1A;font-size:14px;line-height:1.5;letter-spacing:0.3px;font-weight:350;margin:0;padding:0;font-family:Inter,Arial,sans-serif;">

          <!-- Preheader -->
          <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">
            Great news — your project has reached an important milestone
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <!-- Main Container -->
          <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;background-color:#0C1829;margin-right:auto;margin-left:auto;">
            <tbody>
              <tr style="width:100%;">
                <td>

                  <!-- ===== HEADER — Logo on Light Background ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;">
                    <tbody>
                      <tr>
                        <td style="padding:1.25rem 1.5rem;">
                          <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                            <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:140px;" width="140" />
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== CELEBRATION BANNER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tbody>
                      <tr>
                        <td style="background-color:#C9A84C;padding:0.625rem 1.5rem;text-align:center;">
                          <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tbody>
                              <tr>
                                <td valign="middle" style="padding-right:0.5rem;">
                                  <img alt="" height="16" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="16" />
                                </td>
                                <td valign="middle">
                                  <p style='font-size:12px;line-height:1;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;letter-spacing:1px;'>
                                    Milestone Achieved
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== HERO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4 mobile_pt-10" style="padding:3rem 1.5rem 1.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:11px;line-height:1;letter-spacing:1.2px;font-weight:500;color:#C9A84C;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                            Project Update
                          </p>
                          <p class="mobile_font-40" style='font-size:48px;line-height:1;letter-spacing:-1.4px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;text-transform:uppercase;'>
                            Another Step<br/>Complete
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== INTRO ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0.5rem 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Dear {name},
                          </p>
                          <p class="mobile_max-w-full" style="font-size:14px;line-height:1.7;letter-spacing:0.3px;font-weight:350;color:#B8C4D6;margin:0;max-width:480px;font-family:Inter,Arial,sans-serif;">
                            Great news! Your project at <span style="color:#FFFFFF;font-weight:450;">{location}</span> has reached an important milestone. Here's a summary of the progress.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== MILESTONE CARD ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;overflow:hidden;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">

                            <!-- Card Header -->
                            <tr>
                              <td style="background-color:#C9A84C;padding:0.875rem 1.5rem;">
                                <p style='font-size:13px;line-height:1;letter-spacing:0.6px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#0C1829;margin:0;text-transform:uppercase;'>
                                  Milestone Completed
                                </p>
                              </td>
                            </tr>

                            <!-- Milestone Name -->
                            <tr>
                              <td style="padding:1.75rem 1.5rem 1.25rem 1.5rem;border-bottom:1px solid #1A2A42;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="40" valign="top" style="padding-top:4px;">
                                      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:28px;height:28px;background-color:#C9A84C;border-radius:50%;">
                                        <tr>
                                          <td style="text-align:center;vertical-align:middle;">
                                            <img alt="" height="14" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto;" width="14" />
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                    <td style="padding-left:0.75rem;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0 0 0.375rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Milestone
                                      </p>
                                      <p style='font-size:22px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {milestone}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <!-- Completion Date -->
                            <tr>
                              <td style="padding:1.25rem 1.5rem;">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                  <tr>
                                    <td width="40" valign="top" style="padding-top:2px;">
                                      <img alt="" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="20" />
                                    </td>
                                    <td style="padding-left:0.75rem;">
                                      <p style="font-size:12px;line-height:1.4;letter-spacing:0.3px;font-weight:300;color:#6B7F9E;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Completion Date
                                      </p>
                                      <p style='font-size:16px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0;'>
                                        {date}
                                      </p>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== PROGRESS INDICATOR ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p class="mobile_font-24" style='font-size:28px;line-height:0.9;letter-spacing:0.3px;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 1.75rem 0;text-transform:uppercase;'>
                            Project Progress
                          </p>

                          <!-- Progress Bar Background -->
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:2rem;">
                            <tbody>
                              <tr>
                                <td style="background-color:#1A2A42;border-radius:100px;height:6px;font-size:0;line-height:0;">
                                  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                    <tbody>
                                      <tr>
                                        <td width="60%" style="background-color:#C9A84C;border-radius:100px;height:6px;font-size:0;line-height:0;" width="60%"></td>
                                        <td width="40%" style="font-size:0;line-height:0;" width="40%"></td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            </tbody>
                          </table>

                          <!-- Progress Steps -->
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <!-- Step 1 — Complete -->
                              <td class="mobile_progress_full mobile_progress_last" style="width:25%;vertical-align:top;padding-right:0.25rem;text-align:center;">
                                <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                  <tbody>
                                    <tr>
                                      <td style="width:24px;height:24px;background-color:#C9A84C;border-radius:50%;text-align:center;vertical-align:middle;">
                                        <img alt="" height="12" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto;" width="12" />
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                                <p style='font-size:11px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0.5rem 0 0 0;text-transform:uppercase;'>
                                  Foundation
                                </p>
                              </td>

                              <!-- Step 2 — Complete -->
                              <td class="mobile_progress_full mobile_progress_last" style="width:25%;vertical-align:top;padding-left:0.25rem;padding-right:0.25rem;text-align:center;">
                                <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                  <tbody>
                                    <tr>
                                      <td style="width:24px;height:24px;background-color:#C9A84C;border-radius:50%;text-align:center;vertical-align:middle;">
                                        <img alt="" height="12" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;margin:0 auto;" width="12" />
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                                <p style='font-size:11px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0.5rem 0 0 0;text-transform:uppercase;'>
                                  Frame
                                </p>
                              </td>

                              <!-- Step 3 — Current (gold ring) -->
                              <td class="mobile_progress_full mobile_progress_last" style="width:25%;vertical-align:top;padding-left:0.25rem;padding-right:0.25rem;text-align:center;">
                                <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                  <tbody>
                                    <tr>
                                      <td style="width:24px;height:24px;background-color:#0C1829;border:2px solid #C9A84C;border-radius:50%;text-align:center;vertical-align:middle;">
                                        <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                          <tbody>
                                            <tr>
                                              <td style="width:8px;height:8px;background-color:#C9A84C;border-radius:50%;font-size:0;line-height:0;"></td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                                <p style='font-size:11px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0.5rem 0 0 0;text-transform:uppercase;'>
                                  Lock-Up
                                </p>
                              </td>

                              <!-- Step 4 — Upcoming -->
                              <td class="mobile_progress_full mobile_progress_last" style="width:25%;vertical-align:top;padding-left:0.25rem;text-align:center;">
                                <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                  <tbody>
                                    <tr>
                                      <td style="width:24px;height:24px;background-color:#0C1829;border:2px solid #1A2A42;border-radius:50%;text-align:center;vertical-align:middle;">
                                        <table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                                          <tbody>
                                            <tr>
                                              <td style="width:8px;height:8px;background-color:#1A2A42;border-radius:50%;font-size:0;line-height:0;"></td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                                <p style='font-size:11px;line-height:1.3;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#6B7F9E;margin:0.5rem 0 0 0;text-transform:uppercase;'>
                                  Handover
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== PHOTO UPDATES CTA ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border:1px solid #1A2A42;border-radius:6px;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1.5rem;">
                                  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                                    <tr>
                                      <td valign="top" style="padding-right:1rem;">
                                        <!-- Camera Icon -->
                                        <img alt="" height="28" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'%3E%3C/path%3E%3Ccircle cx='12' cy='13' r='4'%3E%3C/circle%3E%3C/svg%3E" style="display:block;outline:none;border:none;text-decoration:none;" width="28" />
                                      </td>
                                      <td valign="top">
                                        <p style='font-size:15px;line-height:1.2;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#FFFFFF;margin:0 0 0.375rem 0;'>
                                          Photo Updates Available
                                        </p>
                                        <p style="font-size:13px;line-height:1.5;letter-spacing:0.2px;font-weight:350;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                          See the latest progress photos from your site on the client portal.
                                        </p>
                                        <a href="https://royalconstructions.com.au/portal/" style="color:#C9A84C;text-decoration:none;font-size:14px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;font-family:Inter,Arial,sans-serif;" target="_blank">View Photos&nbsp;→</a>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== NEXT MILESTONE ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 2.5rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="background-color:#0F1E33;border-radius:4px;border-left:3px solid #C9A84C;">
                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tbody>
                              <tr>
                                <td style="padding:1rem 1.25rem;">
                                  <p style="font-size:11px;line-height:1.4;letter-spacing:0.6px;font-weight:500;color:#6B7F9E;margin:0 0 0.375rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                    Coming up next
                                  </p>
                                  <p style="font-size:14px;line-height:1.5;letter-spacing:0.2px;font-weight:400;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                                    The next milestone is <span style="color:#FFFFFF;font-weight:450;">{nextMilestone}</span>. We'll keep you updated as your project progresses.
                                  </p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== QUESTIONS ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td>
                          <p style="font-size:15px;line-height:1.5;letter-spacing:-0.075px;font-weight:450;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Questions about your build?
                          </p>
                          <p class="mobile_max-w-full" style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#B8C4D6;margin:0;max-width:490px;font-family:Inter,Arial,sans-serif;">
                            If you have any questions, do not hesitate to reach out at
                            <a href="mailto:info@royalconstructions.com.au" style="color:#C9A84C;text-decoration:none;">info@royalconstructions.com.au</a>
                            or call
                            <a href="tel:1300832355" style="color:#C9A84C;text-decoration:none;">1300 832 355</a>.
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== SIGN-OFF ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="mobile_px-4" style="padding:0 1.5rem 3rem 1.5rem;">
                    <tbody>
                      <tr>
                        <td style="border-top:1px solid #1A2A42;padding-top:2rem;">
                          <p style="font-size:14px;line-height:1.6;font-weight:400;color:#FFFFFF;margin:0 0 0.25rem 0;font-family:Inter,Arial,sans-serif;">
                            Kind regards,
                          </p>
                          <p style='font-size:16px;line-height:1.4;font-weight:500;font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif;color:#C9A84C;margin:0 0 0.125rem 0;'>
                            Guri Singh
                          </p>
                          <p style="font-size:13px;line-height:1.5;font-weight:300;color:#B8C4D6;margin:0;font-family:Inter,Arial,sans-serif;">
                            Royal Constructions NSW
                          </p>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- ===== FOOTER ===== -->
                  <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #1A2A42;background-color:#0A1525;">
                    <tbody>
                      <tr>
                        <td class="mobile_px-4 mobile_py-12" style="padding:3rem 1.5rem;">

                          <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>

                              <!-- LEFT COLUMN -->
                              <td class="mobile_footer_left" style="width:55%;vertical-align:top;padding-right:2rem;">

                                <!-- Footer Logo on light background -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;margin-bottom:1.25rem;">
                                  <tr>
                                    <td style="padding:0.75rem 1rem;">
                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Royal Constructions" src="https://royal-construction-chi.vercel.app/logo-1024x713.png" style="display:block;outline:none;border:none;text-decoration:none;height:auto;width:110px;" width="110" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <p style="font-size:13px;line-height:1.6;letter-spacing:0.2px;font-weight:300;color:#8A9BB5;margin:0 0 1.5rem 0;max-width:280px;font-family:Inter,Arial,sans-serif;">
                                  Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
                                </p>

                                <!-- Social Links with Icons -->
                                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:1.5rem;">
                                  <tr>
                                    <td style="padding-right:1rem;">
                                      <a href="https://www.facebook.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Facebook" height="24" src="https://royal-construction-chi.vercel.app/facebook.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                    <td>
                                      <a href="https://www.instagram.com/royalconstructionsau/" target="_blank" style="display:inline-block;text-decoration:none;">
                                        <img alt="Instagram" height="24" src="https://royal-construction-chi.vercel.app/instagram.svg" style="display:block;outline:none;border:none;text-decoration:none;" width="24" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                                <!-- Office -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Office</span><br/>
                                  38/62 Turner RD<br/>
                                  Smeaton Grange, NSW 2567
                                </p>

                                <!-- Contact -->
                                <p style="font-size:11px;line-height:1.6;letter-spacing:0.3px;font-weight:300;color:#8A9BB5;margin:0 0 1.25rem 0;font-family:Inter,Arial,sans-serif;">
                                  <span style="color:#FFFFFF;font-weight:450;">Contact</span><br/>
                                  <a href="tel:1300832355" style="color:#8A9BB5;text-decoration:none;">1300 832 355</a><br/>
                                  <a href="mailto:info@royalconstructions.com.au" style="color:#8A9BB5;text-decoration:none;">info@royalconstructions.com.au</a>
                                </p>

                                <!-- Unsubscribe -->
                                <p style="font-size:11px;line-height:1.5;letter-spacing:0.3px;font-weight:300;color:#3D5070;margin:0;font-family:Inter,Arial,sans-serif;">
                                  <a href="#" style="color:#3D5070;text-decoration:none;">Unsubscribe</a> from Royal Constructions marketing emails.
                                </p>
                              </td>

                              <!-- RIGHT COLUMN — ACCREDITED BY -->
                              <td class="mobile_footer_right" style="width:45%;vertical-align:top;padding-left:0.5rem;">

                                <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F5F6F8;border-radius:6px;">
                                  <tr>
                                    <td style="padding:1.25rem;">
                                      <p style="font-size:10px;line-height:1.5;letter-spacing:0.8px;font-weight:500;color:#1A2A42;margin:0 0 1rem 0;font-family:Inter,Arial,sans-serif;text-transform:uppercase;">
                                        Accredited by
                                      </p>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Master Builders Association" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/image-78.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:100px;height:auto;margin-bottom:1rem;" width="100" />
                                      </a>

                                      <a href="https://royalconstructions.com.au/" target="_blank" style="text-decoration:none;">
                                        <img alt="Oran Park" src="https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp" style="display:block;outline:none;border:none;text-decoration:none;width:120px;height:auto;" width="120" />
                                      </a>
                                    </td>
                                  </tr>
                                </table>

                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- ===== END FOOTER ===== -->

                </td>
              </tr>
            </tbody>
          </table>

        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
    category: 'Update',
    body: `Dear {name},

Great news! Your project at {location} has reached an important milestone:

Milestone: {milestone}
Completion Date: {date}

Photo updates are available on your client portal. The next milestone is scheduled for {nextMilestone}.

If you have any questions, do not hesitate to reach out.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
];