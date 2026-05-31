'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Check, Clock, Calendar, Video, ArrowRight, Loader2 } from 'lucide-react';

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

function generateDays() {
  const days = [];
  const now = new Date();
  for (let i = 1; i <= 14; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    days.push(date);
  }
  return days;
}

function generateTimeSlots() {
  const slots = [];
  for (let hour = 9; hour < 17; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
  }
  return slots;
}

const availableDays = generateDays();
const timeSlots = generateTimeSlots();

function BookingContent() {
  const searchParams = useSearchParams();
  const name = searchParams.get('name') || 'Client';
  const email = searchParams.get('email');

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [booked, setBooked] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [joinLink, setJoinLink] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCalendar() {
      try {
        const res = await fetch('/api/graph/read-calender-dateTime?days=14');
        const data = await res.json();
        if (data.success) {
          const busy = data.events.map((event: any) => {
            const startDate = new Date(event.start.dateTime);
            return `${startDate.toISOString().split('T')[0]}T${startDate.toTimeString().slice(0, 5)}`;
          });
          setBusySlots(busy);
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
    if (!selectedDate || !selectedTime || !email) return;
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
        body: JSON.stringify({ name, email, startDateTime }),
      });
      const data = await res.json();
      if (data.success) {
        setBooked(true);
        setJoinLink(data.joinUrl);
      } else {
        setError(data.error || 'Failed to book consultation.');
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const isSlotBusy = (date: Date, time: string) => {
    const dateStr = date.toISOString().split('T')[0];
    return busySlots.includes(`${dateStr}T${time}`);
  };

  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
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

  if (!email) {
    return (
      <div style={{ backgroundColor: BRAND.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.text, fontFamily: 'Inter, Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <p style={{ fontSize: 16 }}>Missing email parameter.</p>
          <p style={{ fontSize: 13, color: BRAND.muted }}>Please use the link provided in your email.</p>
        </div>
      </div>
    );
  }

  if (booked) {
    return (
      <div style={{ backgroundColor: BRAND.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND.white, fontFamily: 'Inter, Arial, sans-serif', padding: 20 }}>
        <div style={{ backgroundColor: BRAND.card, padding: '50px 40px', borderRadius: 16, textAlign: 'center', maxWidth: 480, width: '100%', border: `1px solid ${BRAND.border}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <Check size={36} color={BRAND.success} />
          </div>
          <h1 style={{ color: BRAND.gold, margin: '0 0 12px', fontSize: 24, fontWeight: 700 }}>Consultation Booked!</h1>
          <p style={{ color: BRAND.text, marginTop: 0, fontSize: 14, lineHeight: 1.6 }}>
            Your meeting has been scheduled.
          </p>

          {/* Show the Teams Link immediately if available */}
          {joinLink && (
            <a href={joinLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 20, backgroundColor: BRAND.gold, color: BRAND.dark, padding: '12px 24px', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}>
              Join Teams Meeting
            </a>
          )}

          <div style={{ marginTop: 30, padding: '16px 20px', backgroundColor: BRAND.container, borderRadius: 10, border: `1px solid ${BRAND.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <Video size={16} color={BRAND.gold} />
              <span style={{ fontSize: 13, color: BRAND.muted }}>An invite has also been sent to {email}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: BRAND.dark, minHeight: '100vh', fontFamily: 'Inter, Arial, sans-serif', color: BRAND.white }}>

      {/* ═══ HEADER (Reference Image Style) ═══ */}
      <div style={{ backgroundColor: BRAND.lightBg, borderBottom: `1px solid #E2E8F0` }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img
            src={LOGO_URL}
            alt="Royal Constructions"
            style={{ height: 48, width: 'auto', objectFit: 'contain' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22C55E' }} />
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>Booking System</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 60px' }}>

        {/* ── Header ── */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 50, padding: '6px 16px', marginBottom: 20 }}>
            <Calendar size={14} color={BRAND.gold} />
            <span style={{ fontSize: 12, fontWeight: 600, color: BRAND.gold, letterSpacing: '0.5px' }}>BOOKING PAGE</span>
          </div>
          <h1 style={{ color: BRAND.white, fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.5px' }}>Book Your Consultation</h1>
          <p style={{ color: BRAND.muted, fontSize: 14, margin: 0 }}>
            Welcome, <strong style={{ color: BRAND.gold }}>{name}</strong>. Choose a date and time below.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Loader2 size={32} color={BRAND.gold} style={{ animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ color: BRAND.muted, marginTop: 16, fontSize: 14 }}>Loading availability...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* ═══ DATE SELECTION ═══ */}
            <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Calendar size={16} color={BRAND.gold} />
                  <h3 style={{ margin: 0, color: BRAND.white, fontSize: 15, fontWeight: 600, letterSpacing: '0.3px' }}>Select a Date</h3>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: BRAND.dimmed, marginBottom: 16 }}>Choose from the next 14 available business days</p>
              </div>

              <div style={{ padding: '0 24px 20px', overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, minWidth: 580 }}>
                  {availableDays.map((date) => {
                    const isSelected = selectedDate?.toDateString() === date.toDateString();
                    const weekend = isWeekend(date);

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '12px 4px',
                          borderRadius: 10,
                          border: `1.5px solid ${isSelected ? BRAND.gold : weekend ? 'rgba(26,42,66,0.5)' : BRAND.border}`,
                          backgroundColor: isSelected ? 'rgba(201,168,76,0.1)' : weekend ? 'rgba(7,14,26,0.4)' : BRAND.container,
                          cursor: weekend ? 'default' : 'pointer',
                          transition: 'all 0.15s ease',
                          opacity: weekend ? 0.35 : 1,
                          position: 'relative',
                        }}
                      >
                        <span style={{ fontSize: 10, fontWeight: 600, color: isSelected ? BRAND.gold : BRAND.dimmed, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {date.toLocaleDateString('en-AU', { weekday: 'short' }).slice(0, 3)}
                        </span>
                        <span style={{ fontSize: 22, fontWeight: 700, color: isSelected ? BRAND.gold : BRAND.white, marginTop: 2, lineHeight: 1 }}>
                          {date.getDate()}
                        </span>
                        <span style={{ fontSize: 10, color: isSelected ? BRAND.gold : BRAND.dimmed, marginTop: 2 }}>
                          {date.toLocaleDateString('en-AU', { month: 'short' })}
                        </span>
                        {isSelected && (
                          <div style={{ position: 'absolute', bottom: -1.5, left: '20%', right: '20%', height: 2.5, borderRadius: 2, backgroundColor: BRAND.gold }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ═══ TIME SELECTION ═══ */}
            {selectedDate && (
              <div style={{ backgroundColor: BRAND.card, borderRadius: 14, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Clock size={16} color={BRAND.gold} />
                    <h3 style={{ margin: 0, color: BRAND.white, fontSize: 15, fontWeight: 600, letterSpacing: '0.3px' }}>Select a Time</h3>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: BRAND.dimmed, backgroundColor: BRAND.container, padding: '3px 10px', borderRadius: 20, border: `1px solid ${BRAND.border}` }}>
                      {formatDateLong(selectedDate)}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: BRAND.dimmed, marginBottom: 16 }}>All times shown in AEST (Sydney time) · 1-hour sessions</p>
                </div>

                <div style={{ padding: '0 24px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
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
                            padding: '14px 8px',
                            borderRadius: 10,
                            border: `1.5px solid ${isSelected ? BRAND.gold : busy ? 'rgba(26,42,66,0.3)' : BRAND.border}`,
                            backgroundColor: busy ? 'rgba(7,14,26,0.3)' : isSelected ? 'rgba(201,168,76,0.1)' : BRAND.container,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            opacity: busy ? 0.35 : 1,
                            transition: 'all 0.15s ease',
                            position: 'relative',
                          }}
                        >
                          <span style={{ fontSize: 15, fontWeight: 600, color: busy ? BRAND.dimmed : isSelected ? BRAND.gold : BRAND.white }}>
                            {formatTimeDisplay(time)}
                          </span>
                          {busy && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: BRAND.error, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Booked
                            </span>
                          )}
                          {isSelected && !busy && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: BRAND.gold, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

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
                      letterSpacing: '0.3px',
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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