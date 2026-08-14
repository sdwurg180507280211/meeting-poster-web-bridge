(() => {
  const location = document.getElementById('meetingLocation');
  if (location) location.value = '线上';

  ['chair-title', 'speaker1-title', 'speaker2-title'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = '教授';
    input.readOnly = true;
  });
})();
