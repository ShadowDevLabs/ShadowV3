
function changeTheme() {
  const selectedOption = document.getElementById('themeSelector').value;
  changetheme(selectedOption);
  localStorage.setItem('theme', selectedOption);
}

function changetheme(theme) {
  const root = document.documentElement;

  if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('blueneon');
  } else if (theme === 'blueneon') {
      root.classList.add('blueneon');
      root.classList.remove('light');
  } else {
      root.classList.remove('light', 'blueneon');
  }
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
      document.getElementById('themeSelector').value = theme;
  }
});