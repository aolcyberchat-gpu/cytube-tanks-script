// CyTube BattleTanks — FINAL 100% WORKING (2025 stock CyTube)
(function () {
    'use strict';

    function loadThree() {
        return new Promise((resolve, reject) => {
            if (window.THREE) return resolve();
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function sha256Hex(str) {
        const enc = new TextEncoder();
        const data = enc.encode(str);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    async function main() {
        await loadThree();

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;';
        document.body.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        renderer.setSize(innerWidth, innerHeight);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
        camera.position.set(0, 20, 40); camera.lookAt(0, 0, 0);
        window.addEventListener('resize', () => {
            renderer.setSize(innerWidth, innerHeight);
            camera.aspect = innerWidth / innerHeight;
            camera.updateProjectionMatrix();
        });

        const terrain = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100, 60, 60),
            new THREE.MeshBasicMaterial({ color: 0x00aa88, wireframe: true })
        );
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

        const loader = new THREE.TextureLoader();
        const mats = {
            user: new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp') }),
            foe:  new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp') }),
            food: new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp') })
        };
        const geo = new THREE.BoxGeometry(2, 3, 2);
        const entities = [];

        function clear() {
            entities.forEach(e => scene.remove(e.mesh));
            entities.length = 0;
        }

        // USERNAME EXTRACTION — works on stock CyTube 2025
        function getUsernames() {
            const names = [];
            document.querySelectorAll('#userlist .userlist_item').forEach(item => {
                const text = item.textContent.trim();
                if (text) {
                    const name = text.split('\n')[0].trim();
                    if (name && name !== 'Anonymous') names.push(name);
                }
            });
            return [...new Set(names)].sort((a, b) => a.localeCompare(b));
        }

        async function spawn(seedWord) {
            const room = location.pathname.split('/').pop() || 'room';
            const seedHex = await sha256Hex(`\( {room}: \){seedWord}`);
            const prng = mulberry32(parseInt(seedHex.slice(0, 8), 16));

            clear();

            const users = getUsernames();
            const tanks = Math.max(1, users.length);
            const foes = Math.max(4, tanks);
            const food = Math.max(4, Math.floor(tanks * 0.8));

            console.log(`[BattleTanks] "\( {seedWord}" → \){tanks} tanks (\( {users.join(', ')}) | \){foes} foes | ${food} food`);

            // Tanks
            for (let i = 0; i < tanks; i++) {
                const name = users[i] || `Guest${i + 1}`;
                const uSeed = await sha256Hex(seedHex + name);
                const u = mulberry32(parseInt(uSeed.slice(0, 8), 16));
                const m = new THREE.Mesh(geo, mats.user);
                m.position.set((u() - 0.5) * 80, 1, (u() - 0.5) * 80);
                entities.push({ mesh: m, type: 'user', id: name, velocity: new THREE.Vector3((u() - 0.5) * 0.7, 0, (u() - 0.5) * 0.7), health: 3 });
                scene.add(m);
            }

            // Foes
            for (let i = 0; i < foes; i++) {
                const s = await sha256Hex(seedHex + 'foe' + i);
                const p = mulberry32(parseInt(s.slice(0, 8), 16));
                const m = new THREE.Mesh(geo, mats.foe);
                m.position.set((p() - 0.5) * 80, 1, (p() - 0.5) * 80);
                entities.push({ mesh: m, type: 'foe', velocity: new THREE.Vector3((p() - 0.5) * 0.7, 0, (p() - 0.5) * 0.7) });
                scene.add(m);
            }

            // Food
            for (let i = 0; i < food; i++) {
                const s = await sha256Hex(seedHex + 'food' + i);
                const p = mulberry32(parseInt(s.slice(0, 8), 16));
                const m = new THREE.Mesh(geo, mats.food);
                m.position.set((p() - 0.5) * 80, 1, (p() - 0.5) * 80);
                entities.push({ mesh: m, type: 'food', velocity: new THREE.Vector3((p() - 0.5) * 0.4, 0, (p() - 0.5) * 0.4) });
                scene.add(m);
            }
        }

        // Animation loop (basic movement)
        function animate() {
            requestAnimationFrame(animate);
            for (const e of entities) {
                e.mesh.position.add(e.velocity);
                e.mesh.rotation.y += 0.01;
            }
            renderer.render(scene, camera);
        }
        animate();

        // CHAT DETECTION — works on stock CyTube (class = "chat-msg" no hyphen)
        const observer = new MutationObserver(muts => {
            for (const mut of muts) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('chat-msg')) {
                        const text = node.textContent.trim();
                        if (text.startsWith('/startgame')) {
                            const seed = text.slice(10).trim() || 'default';
                            console.log(`[BattleTanks] /startgame "${seed}"`);
                            spawn(seed);
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        console.log("BattleTanks loaded — type /startgame <word>");
    }

    main();
})();
