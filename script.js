

        const AppState = {
            currentView: 'home',
            currency: 'USD',
            coins: [],
            exchanges: [],
            news: [],
            selectedCoin: null,
            searchQuery: '',
            usdToInrRate: 83.5, // Fallback exchange rate
            priceWs: null
        };



        const formatCurrency = (num) => {
            return new Intl.NumberFormat('en-' + (AppState.currency === 'INR' ? 'IN' : 'US'), { 
                style: 'currency', 
                currency: AppState.currency, 
                maximumSignificantDigits: 6 
            }).format(num);
        };
        const formatCompact = (num) => {
            return new Intl.NumberFormat('en-' + (AppState.currency === 'INR' ? 'IN' : 'US'), { 
                notation: "compact", 
                compactDisplay: "short",
                style: 'currency',
                currency: AppState.currency 
            }).format(num);
        };

        const app = {
            async init() {
                try {
                    const loader = document.getElementById('loader-overlay');
                    if (loader) {
                        loader.style.opacity = '1';
                        loader.style.pointerEvents = 'auto';
                    }
                    
                    this.updateCurrencyUI();
                    await this.fetchData();
                    this.initRealtime();
                } catch (e) {
                    console.error("API Fetch Error:", e);
                    alert("Failed to load real-time crypto data from APIs. You may be severely rate-limited by CoinGecko. Please wait a bit and try again.");
                } finally {
                    AppState.isLoading = false;
                    const loader = document.getElementById('loader-overlay');
                    if (loader) {
                        loader.style.opacity = '0';
                        loader.style.pointerEvents = 'none';
                    }
                    this.render();
                }
            },

            async fetchData() {
                // Parallel fetching with timeout
                const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));
                
                const currency = AppState.currency.toLowerCase();
                // Increased per_page to 100
                const fetchCoins = fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h`);
                const fetchExchanges = fetch('https://api.coingecko.com/api/v3/exchanges?per_page=10');
                const fetchNews = fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');

                const [coinsRes, exRes, newsRes] = await Promise.race([
                    Promise.all([fetchCoins, fetchExchanges, fetchNews]),
                    timeout(10000) 
                ]);

                if (!coinsRes.ok) throw new Error('API Limit');
                AppState.coins = await coinsRes.json();

                if (!exRes.ok) throw new Error('API Limit');
                AppState.exchanges = await exRes.json();

                if (!newsRes.ok) {
                    console.warn('News API failed');
                } else {
                    const newsJson = await newsRes.json();
                    if (newsJson.Response === 'Error' || !newsJson.Data || !Array.isArray(newsJson.Data)) {
                        console.warn('News API restricted. Falling back to mock news.');
                        AppState.news = [
                            { id: 1, title: "Bitcoin Surges Past Resistance Levels as Institutional Interest Grows", source: "CryptoDaily", body: "Major financial institutions are increasing their holdings, signaling strong long-term confidence in the asset class despite recent volatility.", imageurl: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?q=80&w=1000&auto=format&fit=crop", url: "#" },
                            { id: 2, title: "Ethereum ETF Approval Expected Next Month", source: "CoinTelegraph", body: "Analysts predict a 90% chance of approval by the SEC, potentially unlocking billions in new capital inflow for the Ethereum ecosystem.", imageurl: "https://images.unsplash.com/photo-1622790698141-94e30457ef12?q=80&w=1000&auto=format&fit=crop", url: "#" },
                            { id: 3, title: "Solana Network Upgrade Promises Faster Transaction Speeds", source: "Decrypt", body: "The latest patch aims to resolve congestion issues and improve network stability during peak usage hours, addressing key user concerns.", imageurl: "https://images.unsplash.com/photo-1642104704074-907c0698cbd9?q=80&w=1000&auto=format&fit=crop", url: "#" },
                            { id: 4, title: "Global Crypto Regulation Framework Proposed", source: "Decrypt", body: "International financial authorities have released a draft framework suggesting integrated crypto asset regulation to protect consumers while fostering innovation.", imageurl: "https://images.unsplash.com/photo-1621504450181-5d356f61d307?q=80&w=1000&auto=format&fit=crop", url: "#" },
                            { id: 5, title: "Web3 Adoption Surges in Gaming Industry", source: "CryptoDaily", body: "Traditional game developers are increasingly integrating blockchain elements into their games, offering players true ownership of in-game assets.", imageurl: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?q=80&w=1000&auto=format&fit=crop", url: "#" },
                            { id: 6, title: "DeFi Total Value Locked Reaches New Heights", source: "CoinTelegraph", body: "The decentralized finance ecosystem has seen a significant influx of capital this week as users search for higher yield opportunities.", imageurl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1000&auto=format&fit=crop", url: "#" }
                        ];
                    } else {
                        AppState.news = newsJson.Data.slice(0, 20);
                    }
                }

                // Fetch real-time exchange rate for INR calculation against WebSockets
                if (AppState.currency === 'INR') {
                    try {
                        const rateRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr');
                        const rateData = await rateRes.json();
                        AppState.usdToInrRate = rateData.tether.inr;
                    } catch(e) {}
                }
            },

            initRealtime() {
                if (AppState.priceWs) {
                    AppState.priceWs.close();
                }
                
                // CoinCap FREE real-time WebSocket connection
                AppState.priceWs = new WebSocket('wss://ws.coincap.io/prices?assets=ALL');
                
                AppState.priceWs.onmessage = (msg) => {
                    const prices = JSON.parse(msg.data);
                    
                    for (const [id, priceUsd] of Object.entries(prices)) {
                        const coin = AppState.coins.find(c => c.id === id);
                        if (coin) {
                            const newPrice = AppState.currency === 'INR' ? parseFloat(priceUsd) * AppState.usdToInrRate : parseFloat(priceUsd);
                            
                            // Prevent spam updates unless significant change
                            if (Math.abs(coin.current_price - newPrice) > 0.00001) {
                                const isUp = newPrice > coin.current_price;
                                coin.current_price = newPrice;
                                
                                // Directly target DOM elements to avoid expensive re-renders
                                const elements = document.querySelectorAll(`[data-coin-price="${id}"]`);
                                elements.forEach(el => {
                                    el.innerHTML = formatCurrency(newPrice);
                                    
                                    // Visual flash effect
                                    el.classList.remove('text-white', 'text-up', 'text-down', 'transition-colors', 'duration-500');
                                    el.classList.add(isUp ? 'text-up' : 'text-down');
                                    
                                    setTimeout(() => {
                                        el.classList.add('transition-colors', 'duration-500');
                                        el.classList.remove('text-up', 'text-down');
                                        el.classList.add('text-white');
                                    }, 400);
                                });
                            }
                        }
                    }
                };
            },

            toggleCurrency() {
                AppState.currency = AppState.currency === 'USD' ? 'INR' : 'USD';
                this.init();
            },

            updateCurrencyUI() {
                const icon = document.getElementById('currency-icon');
                const label = document.getElementById('currency-label');
                
                if(AppState.currency === 'USD') {
                    icon.className = 'ph-bold ph-currency-dollar text-sm';
                    label.textContent = 'USD';
                } else {
                    icon.className = 'ph-bold ph-currency-inr text-sm';
                    label.textContent = 'INR';
                }
            },

            // --- SEARCH LOGIC ---
            handleSearch(query) {
                AppState.searchQuery = query.toLowerCase();
                this.updateMarketTable();
            },

            updateMarketTable() {
                const tbody = document.getElementById('market-table-body');
                if (!tbody) return;
                
                const filtered = AppState.coins.filter(c => 
                    c.name.toLowerCase().includes(AppState.searchQuery) || 
                    c.symbol.toLowerCase().includes(AppState.searchQuery)
                );
                
                tbody.innerHTML = this.renderMarketRows(filtered);
            },

            renderMarketRows(coins) {
                if(!coins.length) return `<tr><td colspan="6" class="p-10 text-center text-dark-muted text-lg">No assets found matching "${AppState.searchQuery}"</td></tr>`;
                
                return coins.map(coin => `
                    <tr onclick="app.navTo('details', '${coin.id}')" class="hover:bg-slate-700/30 cursor-pointer transition-colors duration-200 group border-b border-slate-700/30 last:border-0">
                        <td class="p-5 text-center text-dark-muted font-bold font-mono text-base">
                            #${coin.market_cap_rank}
                        </td>
                        <td class="p-5">
                            <div class="flex items-center gap-4">
                                <img src="${coin.image}" class="w-10 h-10 rounded-full shadow-sm group-hover:scale-110 transition-transform duration-300" loading="lazy">
                                <div>
                                    <div class="font-bold text-base text-white group-hover:text-brand-400 transition-colors">${coin.name}</div>
                                    <div class="text-xs font-semibold text-dark-muted uppercase tracking-wider">${coin.symbol}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-5 text-right font-mono text-base text-white font-medium transition-colors duration-500" data-coin-price="${coin.id}">${formatCurrency(coin.current_price)}</td>
                        <td class="p-5 text-right">
                            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-transparent group-hover:border-slate-600 transition-colors ${coin.price_change_percentage_24h >= 0 ? 'bg-green-500/10 text-up' : 'bg-red-500/10 text-down'}">
                                ${coin.price_change_percentage_24h >= 0 ? '▲' : '▼'} ${Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
                            </span>
                        </td>
                        <td class="p-5 text-right text-base text-dark-muted hidden md:table-cell">${formatCompact(coin.market_cap)}</td>
                        <td class="p-5 text-right text-base text-dark-muted hidden md:table-cell">${formatCompact(coin.total_volume)}</td>
                    </tr>
                `).join('');
            },

            navTo(view, param = null) {
                AppState.currentView = view;
                if (param) AppState.selectedCoin = param;
                
                // Update Nav State
                document.querySelectorAll('.nav-link').forEach(el => {
                    el.classList.remove('text-brand-500', 'bg-slate-800/80', 'text-white');
                    el.classList.add('text-dark-muted');
                });
                document.querySelectorAll('.mobile-link').forEach(el => {
                    el.classList.remove('text-brand-500');
                    el.classList.add('text-dark-muted');
                });
                
                // Active Desktop
                const activeDesktop = document.querySelector(`button[onclick="app.navTo('${view}')"].nav-link`);
                if(activeDesktop) {
                    activeDesktop.classList.add('text-brand-500', 'bg-slate-800/80', 'text-white');
                    activeDesktop.classList.remove('text-dark-muted');
                }

                // Active Mobile
                const activeMobile = document.querySelector(`button[onclick="app.navTo('${view}')"].mobile-link`);
                if(activeMobile) {
                    activeMobile.classList.add('text-brand-500');
                    activeMobile.classList.remove('text-dark-muted');
                }
                
                this.render();
                const container = document.getElementById('main-container');
                container.scrollTop = 0;
            },

            render() {
                const container = document.getElementById('main-container');
                container.innerHTML = ''; 

                switch(AppState.currentView) {
                    case 'home': container.innerHTML = this.views.home(); break;
                    case 'market': container.innerHTML = this.views.market(); break;
                    case 'exchanges': container.innerHTML = this.views.exchanges(); break;
                    case 'news': container.innerHTML = this.views.news(); break;
                    case 'details': 
                        container.innerHTML = this.views.details();
                        setTimeout(() => this.initChart(), 0); 
                        break;
                }
            },

            views: {
                home() {
                    const top3 = AppState.coins.slice(0, 3);
                    const trending = AppState.coins.sort((a,b) => b.price_change_percentage_24h - a.price_change_percentage_24h).slice(0, 5);
                    const globalCap = AppState.coins.reduce((acc, coin) => acc + coin.market_cap, 0);

                    return `
                        <div class="p-4 md:p-8 max-w-7xl mx-auto space-y-8 fade-in">
                            <!-- Hero -->
                            <div class="relative bg-gradient-to-r from-brand-900 via-brand-700 to-brand-600 rounded-3xl p-8 md:p-10 overflow-hidden shadow-2xl shadow-brand-900/40 border border-brand-500/20 group hover-lift">
                                <div class="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl group-hover:opacity-10 transition-opacity duration-700"></div>
                                <h2 class="text-brand-100 font-bold text-sm md:text-base uppercase tracking-widest mb-3">Global Market Cap</h2>
                                <h1 class="text-4xl md:text-6xl font-extrabold text-white mb-8 tracking-tight drop-shadow-sm">
                                    ${formatCompact(globalCap)} 
                                    <span class="text-2xl md:text-3xl opacity-70 font-medium">${AppState.currency}</span>
                                </h1>
                                <div class="flex gap-4">
                                    <button onclick="app.navTo('market')" class="bg-white text-brand-900 px-8 py-3.5 rounded-xl text-base font-bold hover:bg-brand-50 transition-all shadow-xl shadow-black/20 transform hover:scale-105 active:scale-95">Explore Market</button>
                                </div>
                            </div>

                            <!-- Top Assets Grid -->
                            <div>
                                <h3 class="text-xl md:text-2xl font-bold text-white mb-5 flex items-center gap-2"><i class="ph-fill ph-trophy text-brand-500"></i> Top Assets</h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    ${top3.map(coin => `
                                        <div onclick="app.navTo('details', '${coin.id}')" class="bg-dark-card border border-slate-700/50 p-6 rounded-2xl cursor-pointer hover:border-brand-500 hover:bg-slate-800 transition-all duration-300 hover-lift group relative overflow-hidden">
                                            <div class="flex items-center gap-4 mb-4 relative z-10">
                                                <img src="${coin.image}" class="w-14 h-14 rounded-full shadow-lg group-hover:scale-110 transition-transform duration-300" alt="${coin.name}">
                                                <div>
                                                    <div class="flex items-center gap-2">
                                                        <h4 class="font-bold text-xl leading-tight text-white group-hover:text-brand-300 transition-colors">${coin.name}</h4>
                                                        <span class="bg-slate-800 text-brand-500 text-xs px-2 py-0.5 rounded-md font-bold border border-slate-700/50">#${coin.market_cap_rank}</span>
                                                    </div>
                                                    <span class="text-sm text-dark-muted font-mono uppercase font-semibold">${coin.symbol}</span>
                                                </div>
                                                <div class="ml-auto text-right">
                                                    <div class="font-mono font-bold text-lg text-white transition-colors duration-500" data-coin-price="${coin.id}">${formatCurrency(coin.current_price)}</div>
                                                    <div class="text-sm font-bold ${coin.price_change_percentage_24h >= 0 ? 'text-up' : 'text-down'} bg-slate-900/50 px-2 py-1 rounded-lg inline-block mt-1">
                                                        ${coin.price_change_percentage_24h.toFixed(2)}%
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="absolute bottom-0 left-0 h-1.5 w-full bg-slate-700/30">
                                                <div class="h-full ${coin.price_change_percentage_24h >= 0 ? 'bg-up' : 'bg-down'} opacity-50 group-hover:opacity-100 transition-opacity" style="width: ${Math.min(Math.abs(coin.price_change_percentage_24h) * 10, 100)}%"></div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- Trending List -->
                            <div>
                                <h3 class="text-xl md:text-2xl font-bold text-white mb-5 flex items-center gap-2"><i class="ph-fill ph-trend-up text-up"></i> Top Gainers (24h)</h3>
                                <div class="bg-dark-card border border-slate-700/50 rounded-2xl overflow-hidden shadow-lg">
                                    ${trending.map((coin, index) => `
                                        <div onclick="app.navTo('details', '${coin.id}')" class="flex items-center justify-between p-5 border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer transition-all duration-200 last:border-0 group">
                                            <div class="flex items-center gap-4">
                                                <span class="text-dark-muted font-mono text-sm w-6 font-bold group-hover:text-white transition-colors">${index + 1}</span>
                                                <img src="${coin.image}" class="w-10 h-10 rounded-full group-hover:scale-110 transition-transform">
                                                <div>
                                                    <div class="font-bold text-base text-white group-hover:text-brand-300 transition-colors">${coin.name}</div>
                                                    <div class="text-sm text-dark-muted font-semibold">${coin.symbol.toUpperCase()}</div>
                                                </div>
                                            </div>
                                            <div class="text-right">
                                                <div class="font-bold text-base text-white transition-colors duration-500" data-coin-price="${coin.id}">${formatCurrency(coin.current_price)}</div>
                                                <div class="text-sm font-bold text-up bg-green-500/10 px-2 py-0.5 rounded mt-1 inline-block">+${coin.price_change_percentage_24h.toFixed(2)}%</div>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                },

                market() {
                    const filtered = AppState.coins.filter(c => 
                        c.name.toLowerCase().includes(AppState.searchQuery) || 
                        c.symbol.toLowerCase().includes(AppState.searchQuery)
                    );

                    return `
                        <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
                            <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                                <h2 class="text-3xl font-bold text-white">Market Overview</h2>
                                
                                <!-- Search Bar -->
                                <div class="relative w-full md:w-80 group">
                                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <i class="ph-bold ph-magnifying-glass text-dark-muted group-focus-within:text-brand-500 transition-colors"></i>
                                    </div>
                                    <input type="text" 
                                        value="${AppState.searchQuery}"
                                        oninput="app.handleSearch(this.value)"
                                        class="bg-dark-card border border-slate-700 text-white text-base rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 block w-full pl-12 p-3 placeholder-slate-500 transition-all shadow-sm group-hover:border-slate-600" 
                                        placeholder="Search coins...">
                                </div>
                            </div>

                            <div class="bg-dark-card border border-slate-700/50 rounded-2xl overflow-hidden shadow-lg">
                                <div class="overflow-x-auto">
                                    <table class="w-full text-left border-collapse">
                                        <thead class="bg-slate-800/80 text-dark-muted text-sm uppercase font-bold tracking-wider backdrop-blur-sm sticky top-0 z-10 border-b border-slate-700">
                                            <tr>
                                                <th class="p-5 w-20 text-center">Rank</th>
                                                <th class="p-5">Asset</th>
                                                <th class="p-5 text-right">Price</th>
                                                <th class="p-5 text-right">24h Change</th>
                                                <th class="p-5 text-right hidden md:table-cell">Mkt Cap</th>
                                                <th class="p-5 text-right hidden md:table-cell">Vol (24h)</th>
                                            </tr>
                                        </thead>
                                        <tbody id="market-table-body" class="divide-y divide-slate-700/30">
                                            ${app.renderMarketRows(filtered)}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                },

                exchanges() {
                    return `
                        <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
                            <h2 class="text-3xl font-bold mb-8 text-white">Trusted Exchanges</h2>
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                ${AppState.exchanges.map(ex => `
                                    <a href="${ex.url}" target="_blank" class="block bg-dark-card border border-slate-700/50 p-6 rounded-2xl hover:border-brand-500 hover:shadow-xl hover:shadow-brand-500/10 transition-all hover-lift relative overflow-hidden group">
                                        <div class="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-2 group-hover:translate-x-0">
                                            <i class="ph-bold ph-arrow-square-out text-brand-500 text-xl"></i>
                                        </div>
                                        <div class="flex items-center gap-5 mb-5">
                                            <img src="${ex.image}" class="w-16 h-16 rounded-2xl shadow-md bg-white p-1.5" alt="${ex.name}">
                                            <div>
                                                <h3 class="font-bold text-xl text-white group-hover:text-brand-400 transition-colors">${ex.name}</h3>
                                                <div class="text-xs text-brand-500 font-extrabold uppercase tracking-wide bg-brand-500/10 px-2.5 py-1 rounded-full inline-block mt-1.5 border border-brand-500/20">Trust Score: ${ex.trust_score || 10}/10</div>
                                            </div>
                                        </div>
                                        <div class="space-y-3 text-sm md:text-base border-t border-slate-700/50 pt-4">
                                            <div class="flex justify-between text-dark-muted">
                                                <span>24h Vol (BTC)</span>
                                                <span class="font-mono text-white font-medium">${formatCompact(ex.trade_volume_24h_btc)}</span>
                                            </div>
                                            <div class="flex justify-between text-dark-muted">
                                                <span>Est. Year</span>
                                                <span class="text-white font-medium">${ex.year_established || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </a>
                                `).join('')}
                            </div>
                        </div>
                    `;
                },

                news() {
                    return `
                        <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in">
                            <h2 class="text-3xl font-bold mb-8 text-white">Latest Insights</h2>
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                ${AppState.news.map(item => `
                                    <div class="bg-dark-card border border-slate-700/50 rounded-2xl overflow-hidden flex flex-col h-full hover:shadow-2xl hover:border-slate-600 transition-all duration-300 hover-lift group">
                                        <div class="h-56 overflow-hidden relative">
                                            <img src="${item.imageurl}" class="w-full h-full object-cover group-hover:scale-110 transition duration-700 ease-out" onerror="this.src='https://placehold.co/600x400/1e293b/FFF?text=Crypto+News'">
                                            <div class="absolute inset-0 bg-gradient-to-t from-dark-card via-transparent to-transparent opacity-90"></div>
                                            <div class="absolute bottom-4 left-5">
                                                <span class="text-[10px] uppercase tracking-wider font-bold text-white bg-brand-600 px-2.5 py-1 rounded shadow-lg">${item.source_info ? item.source_info.name : (item.source || 'News')}</span>
                                            </div>
                                        </div>
                                        <div class="p-6 flex-1 flex flex-col">
                                            <h3 class="font-bold text-xl mb-3 leading-snug text-white group-hover:text-brand-400 transition-colors">
                                                <a href="${item.url}" target="_blank">${item.title}</a>
                                            </h3>
                                            <p class="text-dark-muted text-base line-clamp-3 mb-6 flex-1 leading-relaxed">${item.body}</p>
                                            <a href="${item.url}" target="_blank" class="text-brand-500 text-sm font-bold hover:text-brand-300 flex items-center gap-1.5 mt-auto group-hover:translate-x-1 transition-transform bg-brand-500/10 w-fit px-4 py-2 rounded-lg hover:bg-brand-500/20">
                                                Read article <i class="ph-bold ph-arrow-right"></i>
                                            </a>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                },

                details() {
                    const coinId = AppState.selectedCoin;
                    const coin = AppState.coins.find(c => c.id === coinId);
                    
                    if(!coin) return `<div class="p-20 text-center text-dark-muted text-xl">Coin data not found</div>`;

                    return `
                        <div class="p-4 md:p-8 max-w-7xl mx-auto fade-in pb-28">
                            <!-- Nav Back -->
                            <button onclick="app.navTo('market')" class="mb-8 flex items-center gap-2.5 text-dark-muted hover:text-white transition-all group w-fit px-4 py-2 rounded-xl hover:bg-slate-800">
                                <i class="ph-bold ph-arrow-left text-lg group-hover:-translate-x-1 transition-transform"></i>
                                <span class="text-base font-medium">Back to Market</span>
                            </button>

                            <!-- Header -->
                            <div class="flex flex-col md:flex-row md:items-start justify-between gap-8 mb-10">
                                <div class="flex items-center gap-6">
                                    <img src="${coin.image}" class="w-20 h-20 md:w-24 md:h-24 rounded-full shadow-2xl border-4 border-slate-700/50 bg-white p-1">
                                    <div>
                                        <h1 class="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight">${coin.name}</h1>
                                        <div class="flex items-center gap-3 flex-wrap">
                                            <span class="text-base text-dark-muted uppercase font-mono font-bold bg-slate-800/80 px-3 py-1 rounded-lg border border-slate-700 shadow-sm">${coin.symbol}</span>
                                            <span class="bg-brand-500/10 text-brand-400 border border-brand-500/20 text-sm px-3 py-1 rounded-full font-bold">Rank #${coin.market_cap_rank}</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="text-left md:text-right bg-slate-800/30 p-6 rounded-2xl md:bg-transparent md:p-0 border border-slate-700/30 md:border-0">
                                    <div class="text-base font-medium text-dark-muted mb-1">Current Price</div>
                                    <div class="text-5xl font-mono font-bold tracking-tighter text-white mb-2 transition-colors duration-500" data-coin-price="${coin.id}">${formatCurrency(coin.current_price)}</div>
                                    <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-bold ${coin.price_change_percentage_24h >= 0 ? 'bg-green-500/10 text-up border border-green-500/20' : 'bg-red-500/10 text-down border border-red-500/20'}">
                                        ${coin.price_change_percentage_24h >= 0 ? '<i class="ph-bold ph-trend-up"></i>' : '<i class="ph-bold ph-trend-down"></i>'} 
                                        ${Math.abs(coin.price_change_percentage_24h).toFixed(2)}% (24h)
                                    </div>
                                </div>
                            </div>

                            <!-- Layout Grid -->
                            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                <!-- Main Chart -->
                                <div class="lg:col-span-2 bg-dark-card border border-slate-700/50 rounded-3xl p-6 md:p-8 shadow-lg">
                                    <div class="flex items-center justify-between mb-8">
                                        <h3 class="font-bold text-xl text-white flex items-center gap-2"><i class="ph-fill ph-chart-line-up text-brand-500"></i> Price Performance (7d)</h3>
                                        <div class="flex gap-4 text-sm md:text-base font-mono bg-slate-900/50 p-1.5 rounded-xl border border-slate-700/50">
                                            <div class="px-3 py-1 rounded-lg text-dark-muted">H: <span class="text-white font-bold">${formatCurrency(coin.high_24h || coin.current_price * 1.05)}</span></div>
                                            <div class="px-3 py-1 rounded-lg text-dark-muted border-l border-slate-700">L: <span class="text-white font-bold">${formatCurrency(coin.low_24h || coin.current_price * 0.95)}</span></div>
                                        </div>
                                    </div>
                                    <div class="relative h-80 w-full">
                                        <canvas id="coinChart"></canvas>
                                    </div>
                                </div>

                                <!-- Statistics Sidebar -->
                                <div class="space-y-6">
                                    <div class="bg-dark-card border border-slate-700/50 rounded-3xl p-8 shadow-lg">
                                        <h3 class="font-bold text-xl mb-6 text-brand-400 flex items-center gap-2"><i class="ph-fill ph-chart-pie-slice"></i> Market Stats</h3>
                                        <div class="space-y-5">
                                            <div class="flex justify-between items-center border-b border-slate-700/50 pb-4 hover:bg-slate-800/20 p-2 rounded transition-colors">
                                                <span class="text-dark-muted text-base">Market Cap</span>
                                                <span class="font-mono font-bold text-white text-lg">${formatCompact(coin.market_cap)}</span>
                                            </div>
                                            <div class="flex justify-between items-center border-b border-slate-700/50 pb-4 hover:bg-slate-800/20 p-2 rounded transition-colors">
                                                <span class="text-dark-muted text-base">Volume (24h)</span>
                                                <span class="font-mono font-bold text-white text-lg">${formatCompact(coin.total_volume)}</span>
                                            </div>
                                            <div class="flex justify-between items-center border-b border-slate-700/50 pb-4 hover:bg-slate-800/20 p-2 rounded transition-colors">
                                                <span class="text-dark-muted text-base">Circulating Supply</span>
                                                <div class="text-right">
                                                    <span class="font-mono font-bold text-white text-lg block">${formatCompact(coin.circulating_supply)}</span>
                                                </div>
                                            </div>
                                            <div class="flex justify-between items-center pt-2 hover:bg-slate-800/20 p-2 rounded transition-colors">
                                                <span class="text-dark-muted text-base">All Time High</span>
                                                <span class="font-mono font-bold text-white text-lg">${formatCurrency(coin.ath)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- CTA Card -->
                                    <div class="bg-gradient-to-br from-brand-900 to-slate-900 border border-brand-500/30 rounded-3xl p-8 relative overflow-hidden group hover-lift">
                                        <div class="absolute -right-8 -bottom-8 text-[10rem] text-brand-500/5 group-hover:text-brand-500/10 transition-colors rotate-12 pointer-events-none duration-500">
                                            <i class="ph-fill ph-currency-circle-dollar"></i>
                                        </div>
                                        <h3 class="font-bold text-white mb-3 text-xl">Trade ${coin.symbol.toUpperCase()}</h3>
                                        <p class="text-base text-brand-100/80 mb-8 relative z-10 leading-relaxed">Compare rates across top exchanges and start trading ${coin.name} securely today.</p>
                                        <button onclick="app.navTo('exchanges')" class="w-full bg-brand-500 hover:bg-brand-600 text-white font-bold text-lg py-4 rounded-2xl transition-all shadow-xl shadow-brand-500/20 relative z-10 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95">
                                            Find Exchanges <i class="ph-bold ph-arrow-right"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            },

            initChart() {
                const coin = AppState.coins.find(c => c.id === AppState.selectedCoin);
                if(!coin || !coin.sparkline_in_7d) return;

                const ctx = document.getElementById('coinChart');
                if(!ctx) return; 

                // Destroy old chart if exists (Chart.js 3+)
                const existingChart = Chart.getChart(ctx);
                if(existingChart) existingChart.destroy();

                const prices = coin.sparkline_in_7d.price;
                const isPositive = prices[prices.length-1] >= prices[0];
                const color = isPositive ? '#10b981' : '#ef4444';
                
                const context2d = ctx.getContext('2d');
                const bgGradient = context2d.createLinearGradient(0, 0, 0, 400);
                bgGradient.addColorStop(0, isPositive ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)');
                bgGradient.addColorStop(1, 'rgba(15, 23, 42, 0)');

                AppState.chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: prices.map((_, i) => i),
                        datasets: [{
                            label: `Price (${AppState.currency})`,
                            data: prices,
                            borderColor: color,
                            backgroundColor: bgGradient,
                            borderWidth: 3,
                            pointRadius: 0,
                            pointHoverRadius: 8,
                            pointHoverBackgroundColor: '#fff',
                            pointHoverBorderColor: color,
                            pointHoverBorderWidth: 3,
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                titleColor: '#94a3b8',
                                bodyColor: '#fff',
                                borderColor: 'rgba(255,255,255,0.1)',
                                borderWidth: 1,
                                padding: 14,
                                displayColors: false,
                                titleFont: { size: 14, family: "'Plus Jakarta Sans', sans-serif" },
                                bodyFont: { size: 14, family: "'Plus Jakarta Sans', sans-serif", weight: 'bold' },
                                callbacks: {
                                    label: function(context) {
                                        return new Intl.NumberFormat('en-US', { style: 'currency', currency: AppState.currency }).format(context.parsed.y);
                                    },
                                    title: () => ''
                                }
                            }
                        },
                        scales: {
                            x: { display: false },
                            y: { 
                                display: true,
                                position: 'right',
                                grid: { color: 'rgba(51, 65, 85, 0.3)', drawBorder: false },
                                ticks: { 
                                    color: '#64748b', 
                                    font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: 600 },
                                    padding: 10,
                                    callback: (val) => new Intl.NumberFormat('en-US', { notation: "compact", style: 'currency', currency: AppState.currency }).format(val)
                                }
                            }
                        },
                        interaction: {
                            mode: 'nearest',
                            axis: 'x',
                            intersect: false
                        }
                    }
                });
            }
        };

        // Start App
        document.addEventListener('DOMContentLoaded', () => {
            app.init();
        });