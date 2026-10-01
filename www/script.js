'use strict';

const Store = {
    get(k, d) {
        try {
            const v = localStorage.getItem('schedule_app_' + k);
            return v !== null ? JSON.parse(v) : d;
        } catch { return d; }
    },
    set(k, v) { localStorage.setItem('schedule_app_' + k, JSON.stringify(v)); }
};

const ScheduleParser = {
    parseSemester(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let table = doc.querySelector('#schedule_table_och_sem table') || doc.querySelector('.schedule_table table');
        if (!table) return [];
        
        const rows = table.querySelectorAll('tbody tr');
        const result = [];
        let currentDayIdx = -1;
        const dayNames = ['пн','вт','ср','чт','пт','сб','вс'];
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.querySelectorAll('td');
            if (cells.length === 0) continue;
            
            let firstCellText = cells[0].innerText.trim().toLowerCase().substring(0,2);
            if (cells[0].classList.contains('day-header') || dayNames.includes(firstCellText)) {
                currentDayIdx = dayNames.indexOf(firstCellText);
            }
            if (currentDayIdx === -1) continue;
            
            if (cells.length === 2 && cells[1].innerText.includes('Выходной')) {
                result.push({ dayIdx: currentDayIdx, isDayOff: true, week: 1 });
                result.push({ dayIdx: currentDayIdx, isDayOff: true, week: 2 });
                continue;
            }
            
            if (cells.length < 4) continue;
            
            const timeCell = cells[1];
            const timeDiv = timeCell.querySelector('.time') || timeCell.querySelector('.extend_time');
            const timeText = timeDiv ? timeDiv.innerText.trim().split('--')[0] : '';
            const startTime = this._normalizeTime(timeText);
            if (!startTime) continue;
            
            const lesson1 = this._parseLesson(cells[2]);
            const lesson2 = this._parseLesson(cells[3]);
            
            if (lesson1) result.push({ dayIdx: currentDayIdx, time: startTime, week: 1, ...lesson1 });
            if (lesson2) result.push({ dayIdx: currentDayIdx, time: startTime, week: 2, ...lesson2 });
        }
        return result;
    },
    
    _normalizeTime(str) {
        const m = str.match(/(\d{1,2}):(\d{2})/);
        return m ? `${String(m[1]).padStart(2,'0')}:${m[2]}` : null;
    },
    
    _parseLesson(cell) {
        if (!cell || cell.innerHTML.trim() === '&nbsp;') return null;
        
        const main = cell.querySelector('.mainScheduleInfo') || cell.querySelector('.ShortScheduleInfo');
        if (!main) return null;
        
        let nameNode = main.childNodes[0];
        let name = nameNode ? nameNode.textContent.trim() : '';
        if (name.endsWith(',')) name = name.slice(0, -1);
        if (!name || name.length < 2) return null;
        
        const typeEl = main.querySelector('.text-muted');
        const type = typeEl ? typeEl.innerText.trim() : '';
        
        const roomLink = main.querySelector('a[href*="/room/"]');
        let location = roomLink ? roomLink.innerText.trim() : '';
        if (!location && main.innerText.includes('неизв.')) location = 'неизв.';
        
        const teacherEl = cell.querySelector('.Teacher a');
        const teacher = teacherEl ? teacherEl.innerText.trim() : '';
        
        return { name, type, location, teacher };
    }
};

class ScheduleApp {
    constructor() {
        this.baseUrl = 'https://rasps.nsuem.ru/group/9-%D0%98%D0%A1403/';
        this.subgroup = Store.get('subgroup', '1');
        this.week = Store.get('week', 'auto');
        this.cachedData = Store.get('cachedData', null);
        
        this.initUI();
        this.loadData(true);

        // Тихое авто-обновление раз в 15 минут
        setInterval(() => this.loadData(false, true), 15 * 60 * 1000); 
    }

    // --- Метод для плавной анимации интерфейса ---
    async animateChange(actionFunc) {
        const container = document.getElementById('cardsContainer');
        container.classList.add('fade-out');
        
        // Ждем пока контейнер плавно исчезнет
        await new Promise(resolve => setTimeout(resolve, 250));
        
        actionFunc(); // Подменяем DOM (рендер карточек)
        
        // Небольшой таймаут, чтобы браузер успел отрисовать новый DOM перед снятием невидимости
        setTimeout(() => container.classList.remove('fade-out'), 30);
    }

    initUI() {
        this.updateSegments();

        document.querySelectorAll('#subgroupControl .segment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this.subgroup === e.target.dataset.subgroup) return;
                this.subgroup = e.target.dataset.subgroup;
                Store.set('subgroup', this.subgroup);
                this.updateSegments();
                this.animateChange(() => this.loadData(false)); 
            });
        });

        document.querySelectorAll('#weekControl .segment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this.week === e.target.dataset.week) return;
                this.week = e.target.dataset.week;
                Store.set('week', this.week);
                this.updateSegments();
                if (this.cachedData) {
                    this.animateChange(() => this.render(this.cachedData));
                }
            });
        });

        document.querySelector('.js-today-btn')?.addEventListener('click', () => this.scrollToToday());
    }

    updateSegments() {
        document.querySelectorAll('#subgroupControl .segment').forEach(b => 
            b.classList.toggle('active', b.dataset.subgroup === this.subgroup));
        document.querySelectorAll('#weekControl .segment').forEach(b => 
            b.classList.toggle('active', b.dataset.week === this.week));
    }

    getActualWeek() {
        if (this.week !== 'auto') return parseInt(this.week, 10);
        const baseDate = new Date(2026, 8, 14); // 14 сентября 2026 (1 неделя)
        const diffWeeks = Math.floor((new Date() - baseDate) / (1000 * 60 * 60 * 24 * 7));
        return (diffWeeks % 2 === 0) ? 1 : 2; 
    }

    async loadData(useCache, isSilent = false) {
        const container = document.getElementById('cardsContainer');
        
        if (!useCache || !this.cachedData) {
            container.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
        }
        
        try {
            const res = await fetch(this.baseUrl + this.subgroup);
            if (!res.ok) throw new Error('Net error');
            const html = await res.text();
            
            const data = ScheduleParser.parseSemester(html);
            if (data.length === 0) throw new Error('No data');
            
            this.cachedData = data;
            Store.set('cachedData', data);
            
            const now = new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
            document.getElementById('updateTime').textContent = now;
            
            if (isSilent) {
                // Если авто-обновление в фоне — рендерим без перемигиваний
                this.render(data);
            } else {
                this.render(data);
            }
            
        } catch (err) {
            if (this.cachedData && useCache) {
                this.render(this.cachedData);
            } else if (!isSilent) {
                container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:30px;font-weight:600;">Нет подключения к сети</div>`;
            }
        }
    }

    render(data) {
        const container = document.getElementById('cardsContainer');
        const targetWeek = this.getActualWeek();
        const filtered = data.filter(l => l.week === targetWeek);
        
        if (filtered.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:var(--text-secondary);padding:40px;font-weight:600;">Пар нет</div>`;
            return;
        }

        const daysMap = new Map();
        filtered.forEach(l => {
            if (!daysMap.has(l.dayIdx)) daysMap.set(l.dayIdx, []);
            daysMap.get(l.dayIdx).push(l);
        });

        const dayNamesFull = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
        const currentDayIdx = (new Date().getDay() === 0) ? 6 : new Date().getDay() - 1;
        const isActualWeekActive = (this.week === 'auto' || parseInt(this.week) === this.getActualWeek());

        let html = '';
        const sortedDays = Array.from(daysMap.keys()).sort((a,b) => a - b);

        for (const dayIdx of sortedDays) {
            const lessons = daysMap.get(dayIdx);
            const isToday = (dayIdx === currentDayIdx);
            
            html += `<div class="day-group" ${isToday ? 'id="today-card"' : ''}>
                        <div class="day-header">${dayNamesFull[dayIdx]} ${isToday ? '<span class="today-badge">Сегодня</span>' : ''}</div>
                        <div class="day-card">`;
            
            if (lessons.length === 1 && lessons[0].isDayOff) {
                html += `<div class="day-off">Выходной</div>`;
            } else {
                lessons.forEach(l => {
                    const isNow = isToday && isActualWeekActive && this.isCurrentLesson(l.time);
                    const endTime = this.addMinutes(l.time, 90);
                    
                    html += `
                        <div class="lesson-row ${isNow ? 'current' : ''}">
                            <div class="time-col">
                                <div class="start-time">${l.time}</div>
                                <div class="end-time">${endTime}</div>
                            </div>
                            <div class="info-col">
                                <div class="lesson-name">${this.escape(l.name)}</div>
                                <div class="lesson-meta">
                                    ${l.type ? `<span class="type-badge">${this.escape(l.type)}</span>` : ''}
                                    <span>${this.escape(l.location)}</span>
                                </div>
                                ${l.teacher ? `<div class="lesson-teacher">${this.escape(l.teacher)}</div>` : ''}
                            </div>
                        </div>`;
                });
            }
            html += `</div></div>`;
        }
        container.innerHTML = html;
    }

    isCurrentLesson(startTime) {
        if (!startTime) return false;
        const [h, m] = startTime.split(':').map(Number);
        const start = h * 60 + m;
        const current = new Date().getHours() * 60 + new Date().getMinutes();
        return current >= start && current < start + 90;
    }

    addMinutes(time, mins) {
        if (!time) return '';
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
    }

    escape(str) { 
        if (!str) return ''; 
        return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); 
    }

    scrollToToday() {
        const el = document.getElementById('today-card');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function showPwaPopupOnce() {
    if (localStorage.getItem('pwa_popup_shown') === 'true') return;
    const isIos = () => /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    if (!isIos() && !window.matchMedia('(display-mode: standalone)').matches) return;

    setTimeout(() => {
        const popup = document.getElementById('pwa-popup');
        if (!popup) return;
        popup.classList.add('show');
        localStorage.setItem('pwa_popup_shown', 'true');
        setTimeout(() => popup.classList.remove('show'), 5000);
    }, 1500);
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new ScheduleApp();
    showPwaPopupOnce();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
