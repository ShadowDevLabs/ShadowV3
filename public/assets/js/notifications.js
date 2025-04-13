function ShowNotification(text, id) {
    const element = document.getElementById(id);
    if (element) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = text;
        
        element.appendChild(notification);

        notification.classList.add('fade-in');

        setTimeout(() => {
            notification.classList.remove('fade-in');
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
            }, 1000); 
        }, 3000);
    }
}
