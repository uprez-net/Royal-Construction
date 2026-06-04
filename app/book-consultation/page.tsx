'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Check, Clock, Calendar, Video, ArrowRight, Loader2 } from 'lucide-react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import Image from 'next/image';

const BRAND = {
  dark: '#070E1A',
  container: '#0C1829',
  card: '#0F1E33',
  border: '#1A2A42',
  gold: '#C9A84C',
  goldHover: '#D4B85E',
  text: '#B8C4D6',
  white: '#FFFFFF',
  muted: '#8A9BB5',
  dimmed: '#3D5070',
  success: '#22C55E',
  error: '#EF4444',
  lightBg: '#F5F6F8',
};

const LOGO_URL = 'https://royal-construction-chi.vercel.app/logo-1024x713.png';
const NOTES_HELPER =
  'Include land size/status, project scope, room counts, granny flat needs, facade/material preferences, timeline, approval status, and quoting/readiness status.';

// Dynamic Time Slot Generator based on Weekday/Weekend
const generateTimeSlots = (date: Date | null) => {
  if (!date) return [];
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  const slots = [];

  if (isWeekend) {
    for (let hour = 9; hour < 14; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  } else {
    for (let hour = 14; hour < 18; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
  }
  return slots;
};

function BookingContent() {
  const searchParams = useSearchParams();
  const initialName = searchParams.get('name') || '';
  const initialEmail = searchParams.get('email') || '';

  const [clientName, setClientName] = useState(initialName);
  const [clientEmail, setClientEmail] = useState(initialEmail);
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [booked, setBooked] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [joinLink, setJoinLink] = useState<string | null>(null);

  const [busySlotsMap, setBusySlotsMap] = useState<Record<string, string[]>>({});

  const timeSlots = generateTimeSlots(selectedDate);

  useEffect(() => {
    async function fetchCalendar() {
      try {
        // Fetch 60 days instead of 14
        const res = await fetch('/api/graph/read-calender-dateTime?days=60');
        const data = await res.json();

        if (data.success) {
          const map: Record<string, string[]> = {};

          data.events.forEach((event: { subject?: string; start: unknown; end: unknown; isAllDay?: boolean }) => {
            const dateTime = (event.start as { dateTime?: string })?.dateTime;
            if (!dateTime) return;

            // Graph API returns "2024-08-01T14:00:00" because of the Prefer header
            const [datePart, timePart] = dateTime.split('T');
            const time = timePart.slice(0, 5); // "14:00"

            if (!map[datePart]) map[datePart] = [];
            if (!map[datePart].includes(time)) {
              map[datePart].push(time);
            }
          });

          setBusySlotsMap(map);
        }
      } catch (err) {
        console.error('Failed to fetch calendar', err);
      } finally {
        setLoading(false);
      }
    }
    fetchCalendar();
  }, []);

  const handleBook = async () => {
    const trimmedName = clientName.trim();
    const trimmedEmail = clientEmail.trim();

    if (!trimmedName || !trimmedEmail) {
      setError('Please enter your name and email to continue.');
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError('Please select a date and time slot.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const year = selectedDate.getFullYear();
    const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
    const day = selectedDate.getDate().toString().padStart(2, '0');
    const startDateTime = `${year}-${month}-${day}T${selectedTime}:00`;

    try {
      const res = await fetch('/api/graph/book-consultant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail, startDateTime, notes: notes.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setBooked(true);
        setJoinLink(data.joinUrl);
      } else {
        setError(data.error || 'Failed to book consultation.');
      }
    } catch (err) {
      console.error('Booking failed', err);
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  // const isSlotBusy = (date: Date, time: string) => {
  //   const dateStr = date.toISOString().split('T')[0];
  //   return busySlots.includes(`${dateStr}T${time}`);
  // };

  // Format date safely to YYYY-MM-DD without timezone offset shifting
  const formatToDateKey = (date: Date) => {
    return date.toLocaleDateString('sv-SE'); // sv-SE locale formats as YYYY-MM-DD
  };

  // Check if a specific time slot is already booked
  const isSlotBusy = (date: Date, time: string) => {
    const dateKey = formatToDateKey(date);
    return (busySlotsMap[dateKey] || []).includes(time);
  };

  // Check if ALL available time slots for a date are booked
  const isDateFullyBooked = (date: Date) => {
    const dateKey = formatToDateKey(date);
    const expectedSlots = generateTimeSlots(date);
    const bookedSlots = busySlotsMap[dateKey] || [];

    // If it's a weekend/weekday and all expected slots are in the booked array, it's full
    return expectedSlots.length > 0 && expectedSlots.every(slot => bookedSlots.includes(slot));
  };

  const formatDateLong = (date: Date) => {
    return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatTimeDisplay = (time: string) => {
    const [h] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hour12}:00 ${ampm}`;
  };

  const displayName = clientName.trim() || 'Client';
  const labelStyle = { fontSize: 11, fontWeight: 600, color: BRAND.dimmed, textTransform: 'uppercase' as const, letterSpacing: '0.5px' };
  const inputStyle = {
    width: '100%',
    borderRadius: 10,
    border: `1.5px solid ${BRAND.border}`,
    backgroundColor: BRAND.container,
    color: BRAND.white,
    padding: '12px 12px',
    fontSize: 13,
    outline: 'none',
  };
  const textareaStyle = {
    ...inputStyle,
    minHeight: 120,
    resize: 'vertical' as const,
    lineHeight: 1.5,
  };

  if (booked) {
    return (
      <div style={{ backgroundColor: BRAND.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.white, fontFamily: 'Inter, Arial, sans-serif', padding: 20 }}>
        <div style={{ backgroundColor: BRAND.card, padding: '50px 40px', borderRadius: 16, textAlign: 'center', maxWidth: 480, width: '100%', border: `1px solid ${BRAND.border}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <Check size={36} color={BRAND.success} />
          </div>
          <h1 style={{ color: BRAND.gold, margin: '0 0 12px', fontSize: 24, fontWeight: 700 }}>Consultation Booked!</h1>
          <p style={{ color: BRAND.text, marginTop: 0, fontSize: 14, lineHeight: 1.6 }}>Your meeting has been scheduled.</p>
          {joinLink && (
            <a href={joinLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 20, backgroundColor: BRAND.gold, color: BRAND.dark, padding: '12px 24px', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}>
              Join Teams Meeting
            </a>
          )}
          <div style={{ marginTop: 30, padding: '16px 20px', backgroundColor: BRAND.container, borderRadius: 10, border: `1px solid ${BRAND.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <Video size={16} color={BRAND.gold} />
              <span style={{ fontSize: 13, color: BRAND.muted }}>An invite has also been sent to {clientEmail}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: BRAND.dark, minHeight: '100vh', fontFamily: 'Inter, Arial, sans-serif', color: BRAND.white }}>
      {/* ═══ HEADER ═══ */}
      <div style={{ backgroundColor: BRAND.lightBg, borderBottom: `1px solid #E2E8F0` }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Image height={1200} width={720} src={LOGO_URL} alt="Royal Constructions" style={{ height: 48, width: 'auto', objectFit: 'contain' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22C55E' }} />
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>Booking System</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px 60px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 50, padding: '6px 16px', marginBottom: 20 }}>
            <Calendar size={14} color={BRAND.gold} />
            <span style={{ fontSize: 12, fontWeight: 600, color: BRAND.gold, letterSpacing: '0.5px' }}>BOOKING PAGE</span>
          </div>
          <h1 style={{ color: BRAND.white, fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.5px' }}>Book Your Consultation</h1>
          <p style={{ color: BRAND.muted, fontSize: 14, margin: 0 }}>
            Welcome, <strong style={{ color: BRAND.gold }}>{displayName}</strong>. Choose a date and time below.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Loader2 size={32} color={BRAND.gold} style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ color: BRAND.muted, marginTop: 16, fontSize: 14 }}>Loading availability...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* ═══ CONTACT DETAILS ═══ */}
            <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: BRAND.gold }} />
                  <h3 style={{ margin: 0, color: BRAND.white, fontSize: 15, fontWeight: 600, letterSpacing: '0.3px' }}>Your Details</h3>
                </div>
                <p style={{ fontSize: 12, color: BRAND.dimmed, marginTop: 0, marginBottom: 16 }}>Confirm your contact details so we can send the invite.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <div>
                    <label htmlFor="booking-name" style={labelStyle}>Full Name</label>
                    <input id="booking-name" name="name" autoComplete="name" type="text" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="e.g. Jaswinder Singh" style={inputStyle} />
                  </div>
                  <div>
                    <label htmlFor="booking-email" style={labelStyle}>Email</label>
                    <input id="booking-email" name="email" autoComplete="email" type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="e.g. name@email.com" style={inputStyle} />
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ NOTES ═══ */}
            <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: BRAND.gold }} />
                  <h3 style={{ margin: 0, color: BRAND.white, fontSize: 15, fontWeight: 600, letterSpacing: '0.3px' }}>Project Notes</h3>
                </div>
                <p style={{ fontSize: 12, color: BRAND.dimmed, marginTop: 0, marginBottom: 12 }}>{NOTES_HELPER}</p>
              </div>
              <div style={{ padding: '0 24px 20px' }}>
                <label htmlFor="booking-notes" style={labelStyle}>Notes</label>
                <textarea
                  id="booking-notes"
                  name="notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Example sample notes: I am looking at a 550 square meter block. I want a 2 bedroom, 2 toilet main build..."
                  rows={5}
                  style={textareaStyle}
                />
              </div>
            </div>

            {/* ═══ DATE & TIME SELECTION (SIDE BY SIDE) ═══ */}
            <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Calendar size={16} color={BRAND.gold} />
                  <h3 style={{ margin: 0, color: BRAND.white, fontSize: 15, fontWeight: 600 }}>Select Date & Time</h3>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: BRAND.dimmed, marginBottom: 16 }}>Choose a date from tomorrow onwards, then pick an available time slot.</p>
              </div>

              <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>

                {/* Left Column: Date Picker */}
                <div style={{ borderRight: `1px solid ${BRAND.border}`, paddingRight: 32, display: 'flex', justifyContent: 'center' }}>
                  <DatePicker
                    selected={selectedDate}
                    onChange={(date: Date | null) => {
                      setSelectedDate(date);
                      setSelectedTime(null);
                    }}
                    minDate={new Date(new Date().setDate(new Date().getDate() + 1))}
                    filterDate={(date: Date) => !isDateFullyBooked(date)} // <-- ADD THIS: Disables full dates
                    inline
                    calendarClassName="royal-booking-calendar"
                  />
                </div>

                {/* Right Column: Time Slots */}
                <div style={{ paddingLeft: 8 }}>
                  {selectedDate ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Clock size={14} color={BRAND.gold} />
                        <span style={{ fontSize: 12, color: BRAND.muted, fontWeight: 500 }}>
                          {formatDateLong(selectedDate)}
                        </span>
                      </div>
                      <div style={{ backgroundColor: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: 8, padding: '6px 10px', marginBottom: 16 }}>
                        <p style={{ margin: 0, fontSize: 11, color: BRAND.gold, fontWeight: 500 }}>
                          {selectedDate.getDay() === 0 || selectedDate.getDay() === 6 ? 'Weekend Hours: 9:00 AM - 2:00 PM' : 'Weekday Hours: 2:00 PM - 6:00 PM'} (AEST)
                        </p>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {timeSlots.map((time) => {
                          const busy = isSlotBusy(selectedDate, time);
                          const isSelected = selectedTime === time;

                          return (
                            <button
                              key={time}
                              disabled={busy}
                              onClick={() => setSelectedTime(time)}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '12px 8px',
                                borderRadius: 8,
                                border: `1.5px solid ${isSelected ? BRAND.gold : busy ? 'rgba(26,42,66,0.3)' : BRAND.border}`,
                                backgroundColor: busy ? 'rgba(7,14,26,0.3)' : isSelected ? 'rgba(201,168,76,0.1)' : BRAND.container,
                                cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy ? 0.35 : 1,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 600, color: busy ? BRAND.dimmed : isSelected ? BRAND.gold : BRAND.white }}>
                                {formatTimeDisplay(time)}
                              </span>
                              {busy && (
                                <span style={{ fontSize: 9, fontWeight: 600, color: BRAND.error, marginTop: 4, textTransform: 'uppercase' }}>
                                  Booked
                                </span>
                              )}
                              {isSelected && !busy && (
                                <span style={{ fontSize: 9, fontWeight: 600, color: BRAND.gold, marginTop: 4, textTransform: 'uppercase' }}>
                                  Selected
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: BRAND.dimmed, textAlign: 'center', padding: '40px 20px' }}>
                      <Calendar size={40} style={{ marginBottom: 16, opacity: 0.4 }} />
                      <p style={{ fontSize: 13, margin: 0 }}>Please select a date first to view available times.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ═══ SUMMARY & CONFIRM ═══ */}
            {selectedDate && selectedTime && (
              <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.gold}40`, overflow: 'hidden' }}>
                <div style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Video size={20} color={BRAND.gold} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: BRAND.white }}>Consultation Summary</h4>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: BRAND.muted }}>1-hour Microsoft Teams meeting</p>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                    <div style={{ backgroundColor: BRAND.container, borderRadius: 10, padding: '14px 16px', border: `1px solid ${BRAND.border}` }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: BRAND.dimmed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Date</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{formatDateLong(selectedDate)}</div>
                    </div>
                    <div style={{ backgroundColor: BRAND.container, borderRadius: 10, padding: '14px 16px', border: `1px solid ${BRAND.border}` }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: BRAND.dimmed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Time</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{formatTimeDisplay(selectedTime)} (AEST)</div>
                    </div>
                  </div>

                  {error && (
                    <div style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, textAlign: 'center' }}>
                      <span style={{ fontSize: 13, color: BRAND.error }}>{error}</span>
                    </div>
                  )}

                  <button
                    onClick={handleBook}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      backgroundColor: submitting ? BRAND.gold + '80' : BRAND.gold,
                      color: BRAND.dark,
                      border: 'none',
                      padding: '14px 24px',
                      borderRadius: 10,
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: submitting ? 'wait' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                        <span>Booking Consultation...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm Booking</span>
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ borderTop: `1px solid ${BRAND.border}`, backgroundColor: BRAND.container, padding: '20px 24px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 12, color: BRAND.dimmed }}>
          © {new Date().getFullYear()} Royal Constructions NSW · 38/62 Turner Rd, Smeaton Grange NSW 2567 · 1300 832 355
        </p>
      </div>

      {/* ═══ DATE PICKER FIXED READABILITY STYLES ═══ */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        
        /* Container Background */
        .royal-booking-calendar {
          background-color: #0C1829 !important;
          border: 1.5px solid #1A2A42 !important;
          border-radius: 10px !important;
          font-family: Inter, Arial, sans-serif !important;
          padding: 16px !important;
          width: 100% !important;
        }
        
        /* Header Background */
        .royal-booking-calendar .react-datepicker__header {
          background-color: #0C1829 !important;
          border-bottom: 1px solid #1A2A42 !important;
          padding: 8px 0 16px !important;
        }
        
        /* Month & Weekday Text */
        .royal-booking-calendar .react-datepicker__current-month,
        .royal-booking-calendar .react-datepicker__day-name {
          color: #e2e8f0 !important; 
          font-weight: 600 !important;
        }
        
        .royal-booking-calendar .react-datepicker__month {
          margin: 0 !important;
        }
        
        /* Date Buttons */
        .royal-booking-calendar .react-datepicker__day {
          color: #cbd5e1 !important; 
          background-color: rgba(255, 255, 255, 0.04) !important; 
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          border-radius: 6px !important;
          margin: 2px !important;
          width: 2.4rem !important;
          height: 2.4rem !important;
          line-height: 2.2rem !important;
          transition: all 0.15s ease !important;
        }
        
        .royal-booking-calendar .react-datepicker__day:hover {
          background-color: rgba(201, 168, 76, 0.15) !important;
          color: #ffffff !important;
          border-color: rgba(201, 168, 76, 0.3) !important;
        }
        
        /* Selected Date */
        .royal-booking-calendar .react-datepicker__day--selected,
        .royal-booking-calendar .react-datepicker__day--keyboard-selected {
          background-color: #C9A84C !important;
          color: #070E1A !important; 
          font-weight: 700 !important;
          border-color: #C9A84C !important;
        }
        
        /* Disabled Dates */
        .royal-booking-calendar .react-datepicker__day--disabled {
          color: #334155 !important; /* Darker gray text */
          background-color: transparent !important;
          border-color: transparent !important;
          opacity: 0.4 !important;
          cursor: not-allowed !important;
        }
        
        /* Hide Days Outside Current Month */
        .royal-booking-calendar .react-datepicker__day--outside-month {
          visibility: hidden !important;
        }
        
        /* Navigation Arrows */
        .royal-booking-calendar .react-datepicker__navigation {
          top: 14px !important;
        }
        .royal-booking-calendar .react-datepicker__navigation-icon::before {
          border-color: #8A9BB5 !important;
          border-width: 2px 2px 0 0 !important;
          height: 7px !important;
          width: 7px !important;
        }
        .royal-booking-calendar .react-datepicker__navigation:hover .react-datepicker__navigation-icon::before {
          border-color: #C9A84C !important;
        }
      `}</style>
    </div>
  );
}

export default function BookConsultationPage() {
  return (
    <Suspense fallback={
      <div style={{ backgroundColor: '#070E1A', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9A84C', fontFamily: 'Inter, Arial, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ marginTop: 16, fontSize: 14 }}>Loading booking page...</p>
        </div>
      </div>
    }>
      <BookingContent />
    </Suspense>
  );
}