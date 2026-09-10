let count = 0;
document.querySelector('#complete-task').addEventListener('click', () => {
  count++;
  document.querySelector('#project-status').textContent =
    count + ' task completed';
});
document.querySelector('#route-change').addEventListener('click', () => {
  history.pushState({}, '', '?view=activity');
  document.querySelector('#activity').innerHTML =
    '<h2>Recent activity</h2><p id="activity-note">Your team made three decisions today.</p>';
});
