// Ticket PDF Generator - Mixler Event Platform
// Requires jspdf (UMD) and qrcode-generator loaded via CDN script tags

export function generateTicketPDF(event, order, attendees) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageW = 210;
  const margin = 20;
  const contentW = pageW - margin * 2;

  // Color palette
  const blue = [21, 61, 182];
  const dark = [31, 41, 55];
  const gray = [107, 114, 128];
  const lightGray = [156, 163, 175];
  const dividerGray = [229, 231, 235];

  const formatT = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const d = new Date();
    d.setHours(+h, +m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const dateObj = new Date(event.event_date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  let timeStr = formatT(event.start_time);
  if (event.end_time) timeStr += ' - ' + formatT(event.end_time);

  const location = [event.location_name, event.location_address].filter(Boolean).join(', ') || 'TBA';

  attendees.forEach((attendee, index) => {
    if (index > 0) doc.addPage();

    // ---- Blue header bar ----
    doc.setFillColor(...blue);
    doc.rect(0, 0, pageW, 44, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('MIXLER', margin, 24);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('EVENT TICKET', margin, 35);

    doc.setFontSize(10);
    doc.text(`Ticket ${index + 1} of ${attendees.length}`, pageW - margin, 35, { align: 'right' });

    // ---- Event title ----
    let y = 60;
    doc.setTextColor(...blue);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize(event.title, contentW);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 9 + 10;

    // Divider
    doc.setDrawColor(...dividerGray);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageW - margin, y);
    y += 10;

    // ---- Date + Time row ----
    doc.setTextColor(...lightGray);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('DATE', margin, y);
    doc.text('TIME', margin + contentW / 2, y);
    y += 5;

    doc.setTextColor(...dark);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(dateStr, margin, y);
    doc.text(timeStr, margin + contentW / 2, y);
    y += 10;

    // ---- Location ----
    doc.setTextColor(...lightGray);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('LOCATION', margin, y);
    y += 5;

    doc.setTextColor(...dark);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const locLines = doc.splitTextToSize(location, contentW);
    doc.text(locLines, margin, y);
    y += locLines.length * 5 + 14;

    // Divider
    doc.line(margin, y, pageW - margin, y);
    y += 10;

    // ---- Attendee name ----
    doc.setTextColor(...lightGray);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('ATTENDEE', margin, y);
    y += 5;

    doc.setTextColor(...dark);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(attendee.full_name, margin, y);
    y += 8;

    // Ticket type
    const ticketTypeName = attendee.ticket_types?.name || attendee.ticket_type_name || '';
    if (ticketTypeName) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...gray);
      doc.text(ticketTypeName, margin, y);
      y += 8;
    }
    y += 6;

    // ---- QR Code ----
    if (attendee.qr_code) {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(attendee.qr_code);
        qr.make();

        const qrSize = 56;
        const qrX = (pageW - qrSize) / 2;
        const qrDataUrl = qr.createDataURL(4, 0);

        doc.addImage(qrDataUrl, 'PNG', qrX, y, qrSize, qrSize);
        y += qrSize + 6;

        doc.setFontSize(7);
        doc.setTextColor(...lightGray);
        doc.text(attendee.qr_code, pageW / 2, y, { align: 'center' });
        y += 14;
      } catch (e) {
        console.error('QR generation failed:', e);
        y += 10;
      }
    }

    // ---- Order info row ----
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    doc.text(`Order #${order.order_number}`, margin, y);
    doc.text(`Ticket ${index + 1} of ${attendees.length}`, pageW - margin, y, { align: 'right' });
    y += 14;

    // Footer divider
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    // ---- Footer ----
    doc.setFontSize(10);
    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'normal');
    doc.text('Present this ticket at the door. Your QR code will be scanned for entry.', pageW / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(...lightGray);
    doc.text('mixler.ca', pageW / 2, y, { align: 'center' });
  });

  const filename = `mixler-tickets-${order.order_number}.pdf`;
  doc.save(filename);
}

// Generate a single attendee ticket and return as base64 string
export function generateSingleTicketBase64(event, order, attendee, index, total) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageW = 210;
  const margin = 20;
  const contentW = pageW - margin * 2;

  const blue = [21, 61, 182];
  const dark = [31, 41, 55];
  const gray = [107, 114, 128];
  const lightGray = [156, 163, 175];
  const dividerGray = [229, 231, 235];

  const formatT = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const d = new Date();
    d.setHours(+h, +m);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const dateObj = new Date(event.event_date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  let timeStr = formatT(event.start_time);
  if (event.end_time) timeStr += ' - ' + formatT(event.end_time);

  const location = [event.location_name, event.location_address].filter(Boolean).join(', ') || 'TBA';

  // Blue header bar
  doc.setFillColor(...blue);
  doc.rect(0, 0, pageW, 44, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('MIXLER', margin, 24);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('EVENT TICKET', margin, 35);
  doc.setFontSize(10);
  doc.text(`Ticket ${index + 1} of ${total}`, pageW - margin, 35, { align: 'right' });

  // Event title
  let y = 60;
  doc.setTextColor(...blue);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(event.title, contentW);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 9 + 10;

  doc.setDrawColor(...dividerGray);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // Date + Time
  doc.setTextColor(...lightGray);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DATE', margin, y);
  doc.text('TIME', margin + contentW / 2, y);
  y += 5;
  doc.setTextColor(...dark);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, margin, y);
  doc.text(timeStr, margin + contentW / 2, y);
  y += 10;

  // Location
  doc.setTextColor(...lightGray);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('LOCATION', margin, y);
  y += 5;
  doc.setTextColor(...dark);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const locLines = doc.splitTextToSize(location, contentW);
  doc.text(locLines, margin, y);
  y += locLines.length * 5 + 14;

  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // Attendee name
  doc.setTextColor(...lightGray);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('ATTENDEE', margin, y);
  y += 5;
  doc.setTextColor(...dark);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(attendee.full_name, margin, y);
  y += 8;

  const ticketTypeName = attendee.ticket_types?.name || attendee.ticket_type_name || '';
  if (ticketTypeName) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    doc.text(ticketTypeName, margin, y);
    y += 8;
  }
  y += 6;

  // QR Code
  if (attendee.qr_code) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(attendee.qr_code);
      qr.make();
      const qrSize = 56;
      const qrX = (pageW - qrSize) / 2;
      const qrDataUrl = qr.createDataURL(4, 0);
      doc.addImage(qrDataUrl, 'PNG', qrX, y, qrSize, qrSize);
      y += qrSize + 6;
      doc.setFontSize(7);
      doc.setTextColor(...lightGray);
      doc.text(attendee.qr_code, pageW / 2, y, { align: 'center' });
      y += 14;
    } catch (e) {
      console.error('QR generation failed:', e);
      y += 10;
    }
  }

  // Order info
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.text(`Order #${order.order_number}`, margin, y);
  doc.text(`Ticket ${index + 1} of ${total}`, pageW - margin, y, { align: 'right' });
  y += 14;

  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // Footer
  doc.setFontSize(10);
  doc.setTextColor(...gray);
  doc.setFont('helvetica', 'normal');
  doc.text('Present this ticket at the door. Your QR code will be scanned for entry.', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.setTextColor(...lightGray);
  doc.text('mixler.ca', pageW / 2, y, { align: 'center' });

  // Return as base64 (strip the data URI prefix)
  const dataUri = doc.output('datauristring');
  return dataUri.split(',')[1];
}
