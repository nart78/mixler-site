// pseo-activity.js
// Handles two jobs on activity pSEO pages:
// 1. Inject live Mixler events from Supabase into #events-slot
// 2. Handle waitlist form submission

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dnuygqdmzjswroyzvkjb.supabase.co';
const SUPABASE_ANON_KEY = window.__MIXLER_ANON_KEY__ || 'REPLACED_BY_GENERATE_PY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function initEventsSlot() {
  const slot = document.getElementById('events-slot');
  if (!slot) return;

  const categorySlug = slot.dataset.categorySlug;
  const activityName = slot.dataset.activityName;
  if (!categorySlug) return;

  slot.innerHTML = '<div class="pseo-events-loading">Loading upcoming events...</div>';

  const today = new Date().toISOString().split('T')[0];

  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, event_date, start_time, end_time, location_name, price_cents, tickets_sold, capacity, slug, event_categories!inner(slug)')
    .eq('event_categories.slug', categorySlug)
    .eq('status', 'published')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(3);

  if (error) {
    console.error('pseo-activity: events fetch error', error);
    renderWaitlist(slot, activityName, categorySlug);
    return;
  }

  if (!events || events.length === 0) {
    renderWaitlist(slot, activityName, categorySlug);
    return;
  }

  renderEvents(slot, events);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  };
}

function formatPrice(cents) {
  if (!cents) return 'Free';
  return '$' + (cents / 100).toFixed(0);
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function renderEvents(slot, events) {
  const cards = events.map(ev => {
    const { day, month } = formatDate(ev.event_date);
    const spotsLeft = ev.capacity - (ev.tickets_sold || 0);
    const timeStr = ev.start_time ? `${formatTime(ev.start_time)}${ev.end_time ? ' – ' + formatTime(ev.end_time) : ''}` : '';
    return `
      <div class="pseo-event-card">
        <div class="pseo-event-date">
          <div class="day">${day}</div>
          <div class="month">${month}</div>
        </div>
        <div class="pseo-event-info">
          <h4>${ev.title}</h4>
          <p>${ev.location_name || ''}${timeStr ? ' · ' + timeStr : ''}${spotsLeft > 0 && spotsLeft <= 20 ? ' · ' + spotsLeft + ' spots left' : ''}</p>
        </div>
        <div class="pseo-event-price">${formatPrice(ev.price_cents)}</div>
      </div>
    `;
  }).join('');

  slot.innerHTML = `
    <div class="pseo-section-label">Upcoming in Calgary</div>
    <h2 class="pseo-section-title">Mixler Events</h2>
    <div class="pseo-events-live">
      <div class="pseo-events-live-label">
        <span class="pseo-live-dot"></span> Live events
      </div>
      ${cards}
      <div class="pseo-events-cta">
        <a href="/events.html" class="pseo-btn-pink" style="text-decoration:none">Grab Your Spot</a>
        <a href="/events.html" style="border:2px solid #153db6;color:#153db6;padding:10px 24px;border-radius:28px;font-weight:600;font-size:0.88rem;font-family:'League Spartan',sans-serif;text-decoration:none">See All Events</a>
      </div>
    </div>
  `;
}

function renderWaitlist(slot, activityName, categorySlug) {
  slot.innerHTML = `
    <div class="pseo-section-label">Stay in the Loop</div>
    <h2 class="pseo-section-title">No Events Right Now</h2>
    <div class="pseo-waitlist">
      <h3>Want to know when we run ${activityName} events?</h3>
      <p>Join the waitlist and we'll email you when we add one. We use this to plan what events to run next.</p>
      <form class="pseo-waitlist-form" id="waitlist-form">
        <input type="email" class="pseo-waitlist-input" placeholder="your@email.com" required>
        <button type="submit" class="pseo-waitlist-btn">Join Waitlist</button>
      </form>
      <div id="waitlist-msg"></div>
    </div>
  `;

  document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input[type=email]').value.trim();
    const btn = e.target.querySelector('button');
    const msg = document.getElementById('waitlist-msg');

    btn.disabled = true;
    btn.textContent = 'Joining...';
    msg.innerHTML = '';

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/join-activity-waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email, activity_slug: categorySlug, activity_name: activityName }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        msg.innerHTML = '<div class="pseo-waitlist-success">You\'re on the list! We\'ll email you when we add this event.</div>';
        e.target.style.display = 'none';
      } else {
        msg.innerHTML = `<div class="pseo-waitlist-error">${data.error || 'Something went wrong. Try again.'}</div>`;
        btn.disabled = false;
        btn.textContent = 'Join Waitlist';
      }
    } catch (err) {
      msg.innerHTML = '<div class="pseo-waitlist-error">Something went wrong. Try again.</div>';
      btn.disabled = false;
      btn.textContent = 'Join Waitlist';
    }
  });
}

initEventsSlot();
