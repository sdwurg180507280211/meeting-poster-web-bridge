(() => {
  function defaultMeetingTime(now = new Date()) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year}年${month}月${day}日 19:00-21:30`;
  }

  const meetingTime = document.getElementById('meetingTime');
  if (meetingTime && !meetingTime.value.trim()) meetingTime.value = defaultMeetingTime();

  const location = document.getElementById('meetingLocation');
  if (location) location.value = '线上';

  ['chair-title', 'speaker1-title', 'speaker2-title'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = '教授';
    input.readOnly = true;
  });
})();