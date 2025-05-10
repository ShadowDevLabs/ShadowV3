class Dewasper {
    constructor() {
        this.errors = [];
        window.onerror = (message, source, line, column) => this.log(message, source, line, column);
    }
 
    log(message, source, line, column, error) {
        const errorObject = {
            message,
            source,
            line,
            column,
            time: new Date().toLocaleString(),
            stack: error ? error.stack : null
        };
        this.errors.push(errorObject);
    }    

    dump(count) {
        if (!Array.isArray(window.errors) || window.errors.length === 0) {
            return "No errors found.";
        } 

        const errors = count ? this.errors.slice(-count) : this.errors;

        const formattedErrors = errors.map((errorObj, index) => {
            return `Error ${index + 1}:
            Message: ${errorObj.message || 'N/A'}
            Source: ${errorObj.source || 'N/A'}
            Line: ${errorObj.line || 'N/A'}
            Column: ${errorObj.column || 'N/A'}
            Time: ${errorObj.time || 'N/A'}
            `;
        });
    
        return formattedErrors.join('\n');
    }
}

