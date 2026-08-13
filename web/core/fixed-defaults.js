(() => {
  const location = document.getElementById('meetingLocation');
  if (location) location.value = '线上';

  ['chair-title', 'speaker1-title', 'speaker2-title'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = '教授';
    input.readOnly = true;

    const label = input.closest('label');
    if (label) {
      label.classList.add('fixed-field-hidden');
      const grid = label.parentElement;
      if (grid && grid.classList.contains('grid2')) grid.classList.add('single-field');
    }
  });
})();
