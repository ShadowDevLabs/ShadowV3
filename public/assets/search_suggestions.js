const searchBar = document.getElementById('search-bar');
const suggestionsContainer = document.getElementById('suggestions');

const getComputedStyle = window.getComputedStyle(document.documentElement);
const accentColor = getComputedStyle.getPropertyValue('--accent-color').trim();

searchBar.addEventListener('input', function () {
  const query = searchBar.value.trim();

  if (query.length > 0) {
    fetch(`/search-api?query=${encodeURIComponent(query)}`)
      .then(response => response.json())
      .then(suggestions => {
        suggestionsContainer.innerHTML = '';

        const topSuggestions = suggestions.slice(0, 5);

        topSuggestions.forEach(item => {
          const div = document.createElement('div');
          div.classList.add('suggestion-item');
          div.textContent = item.phrase;

          div.addEventListener('click', () => {
            searchBar.value = item.phrase;
            suggestionsContainer.innerHTML = '';
            searchBar.style.borderRadius = '20px'; 
            suggestionsContainer.classList.add('hidden');
          });

          suggestionsContainer.appendChild(div);
        });

        suggestionsContainer.style.borderTop = `none`;
        suggestionsContainer.style.borderLeft = `1px solid ${accentColor}`;
        suggestionsContainer.style.borderRight = `1px solid ${accentColor}`;
        suggestionsContainer.style.borderBottom = `1px solid ${accentColor}`;

        searchBar.style.borderRadius = '15px 15px 0 0'; 

        suggestionsContainer.classList.remove('hidden');
      })
      .catch(error => console.error('An error occurred while fetching suggestions:', error));
  } else {
    suggestionsContainer.innerHTML = '';
    searchBar.style.borderRadius = '20px';
    suggestionsContainer.classList.add('hidden');
  }
});

document.addEventListener('click', (event) => {
  if (!suggestionsContainer.contains(event.target) && event.target !== searchBar) {
    suggestionsContainer.classList.add('hidden');
    searchBar.style.borderRadius = '20px'; 
  }
});
