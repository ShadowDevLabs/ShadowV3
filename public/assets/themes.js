
function changeTheme() {
  const selectedOption = document.getElementById('themeSelector').value;
  changetheme(selectedOption);
  localStorage.setItem('theme', selectedOption);
}

function changetheme(theme) {
  const root = document.documentElement;
  root.className = theme;
}


window.addEventListener('storage', function (e) {
  if (e.key === 'theme') {
      const newTheme = e.newValue;
      if (newTheme) {
          changetheme(newTheme);
      }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const theme = localStorage.getItem('theme');
  if (theme) {
      changetheme(theme);
      try{document.getElementById('themeSelector').value = theme;}catch(e){}
  }
});