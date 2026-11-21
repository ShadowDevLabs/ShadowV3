// Collects script errors so "Copy debug info" (menu → More) has something to paste
// into a bug report.
class Dewasper {
    constructor() {
        this.errors = [];
        window.addEventListener("error", (event) => {
            // Resource load failures (images, scripts) arrive here too, without a message.
            if (!event.message) return;
            this.log(event.message, event.filename, event.lineno, event.colno, event.error);
        });
        window.addEventListener("unhandledrejection", (event) => {
            const reason = event.reason;
            this.log(`Unhandled rejection: ${reason?.message ?? reason}`, "", 0, 0, reason);
        });
    }

    log(message, source, line, column, error) {
        this.errors.push({
            message: String(message),
            source,
            line,
            column,
            time: new Date().toLocaleString(),
            stack: error && error.stack ? String(error.stack) : null,
        });
        // A page stuck in an error loop shouldn't grow this without bound.
        if (this.errors.length > 100) this.errors.shift();
    }

    dump(count) {
        const header = `Shadow debug info\nPage: ${location.origin}\nBrowser: ${navigator.userAgent}\nTime: ${new Date().toLocaleString()}\n`;
        if (this.errors.length === 0) return `${header}\nNo errors found.`;

        const errors = count ? this.errors.slice(-count) : this.errors;
        const formatted = errors.map((e, index) =>
            [
                `Error ${index + 1}:`,
                `  Message: ${e.message || "N/A"}`,
                `  Source: ${e.source || "N/A"}`,
                `  Line: ${e.line || "N/A"}`,
                `  Column: ${e.column || "N/A"}`,
                `  Time: ${e.time || "N/A"}`,
                ...(e.stack ? [`  Stack: ${e.stack.split("\n").slice(0, 6).join("\n    ")}`] : []),
            ].join("\n"),
        );
        return `${header}\n${formatted.join("\n\n")}`;
    }
}
