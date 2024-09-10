const searchBar = document.getElementById('search-bar');
const suggestionsContainer = document.getElementById('suggestions');

searchBar.addEventListener('input', function () {
  const query = searchBar.value.trim();

  if (query.length > 0) {
    fetch(`/search-api?query=${encodeURIComponent(query)}`)
      .then(response => response.json())
      .then(data => {
        suggestionsContainer.innerHTML = '';

        const ul = document.createElement('ul');

        const suggestions = data.slice(0, 5);
        suggestions.forEach(item => {
          const li = document.createElement('li');
          li.classList.add('suggestion');
          li.textContent = item.phrase;
          ul.appendChild(li);
        });

        suggestionsContainer.appendChild(ul);
      })
      .catch(error => console.error('An error occured while fetching suggestions:', error));
  } else {
    suggestionsContainer.innerHTML = ''; 
  }
});
