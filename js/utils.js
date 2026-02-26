// Utility Functions - Mixler Event Platform

// Format cents to dollar string
function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// Format date for display
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

// Format time for display
function formatTime(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const date = new Date();
  date.setHours(parseInt(hours), parseInt(minutes));
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Generate Google Calendar URL
function googleCalendarUrl(event) {
  const startDate = event.event_date.replace(/-/g, '');
  const startTime = event.start_time.replace(/:/g, '') + '00';
  const endTime = event.end_time ? event.end_time.replace(/:/g, '') + '00' : '';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startDate}T${startTime}/${endTime ? startDate + 'T' + endTime : ''}`,
    location: event.location_address || event.location_name || '',
    details: event.short_description || event.description || '',
    ctz: 'America/Edmonton'
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Generate .ics file content (Apple Calendar / Outlook)
function generateICS(event) {
  const startDate = event.event_date.replace(/-/g, '');
  const startTime = event.start_time.replace(/:/g, '') + '00';
  const endTime = event.end_time ? event.end_time.replace(/:/g, '') + '00' : startTime;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mixler//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART;TZID=America/Edmonton:${startDate}T${startTime}`,
    `DTEND;TZID=America/Edmonton:${startDate}T${endTime}`,
    `SUMMARY:${escapeICS(event.title)}`,
    `DESCRIPTION:${escapeICS(event.short_description || event.description || '')}`,
    `LOCATION:${escapeICS(event.location_address || event.location_name || '')}`,
    `URL:https://staging.mixler.ca/event.html?slug=${event.slug}`,
    `UID:${event.id}@mixler.ca`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  return ics;
}

// Escape special characters for ICS format
function escapeICS(str) {
  return str.replace(/[,;\\]/g, (match) => '\\' + match).replace(/\n/g, '\\n');
}

// Download .ics file
function downloadICS(event) {
  const ics = generateICS(event);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.slug}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Generate Outlook web URL
function outlookCalendarUrl(event) {
  const startDate = event.event_date + 'T' + event.start_time + ':00';
  const endDate = event.end_time
    ? event.event_date + 'T' + event.end_time + ':00'
    : startDate;

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: startDate,
    enddt: endDate,
    location: event.location_address || event.location_name || '',
    body: event.short_description || ''
  });

  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

// Debounce helper
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Get URL query parameter
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export {
  formatPrice,
  formatDate,
  formatTime,
  googleCalendarUrl,
  generateICS,
  downloadICS,
  outlookCalendarUrl,
  debounce,
  getParam
};
