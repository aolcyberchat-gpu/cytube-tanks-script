// ==UserScript==
// @name         CyTube BattleTanks — Ghost Chat Movement + Collisions
// @namespace    http://www.cytu.be
// @version      1.0.16
// @description  Tanks, foes, food, collisions, health, ghosts controlled via chat keys t,f,g,v
// @match        https://cytu.be/r/BLOGUS
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const MOVE_EVERY_N_TICKS = 8;
    let tickCounter = 0;

    /* ------------------ Three.js loader ------------------ */
    function loadThree() {
        return new Promise(resolve => {
            if (window.THREE) return resolve();
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js';
            s.onload = resolve;
            document.head.appendChild(s);
        });
    }

    /* ------------------ Deterministic RNG ------------------ */
    function mulberry32(a) {
        return function () {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    async function shaSeed(str) {
        const buf = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(str)
        );
        return new Uint32Array(buf)[0];
    }

    /* ------------------ Username label ------------------ */
    function makeLabel(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = '28px monospace';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'center';
        ctx.fillText(name, 128, 40);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(10, 2.5, 1);
        sprite.position.y = 4;
        return sprite;
    }

    /* ------------------ Main ------------------ */
    async function main() {
        await loadThree();

        const canvas = document.createElement('canvas');
        Object.assign(canvas.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '-1',
            pointerEvents: 'none'
        });
        document.body.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        renderer.setSize(innerWidth, innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
        camera.position.set(0, 30, 45);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.AmbientLight(0xffffff));

        const terrain = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif')
            })
        );
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);

        const loader = new THREE.TextureLoader();
        const tankMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp') });
        const foeMat  = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp') });
        const foodMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp') });
        const ghostMat = new THREE.MeshBasicMaterial({ color: 0x888888, opacity: 0.7, transparent: true });

        const geo = new THREE.BoxGeometry(2, 3, 2);
        const entities = [];

        function spawnEntity(mat, rng, type, name = null) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(
                Math.round((rng() - 0.5) * 80),
                1,
                Math.round((rng() - 0.5) * 80)
            );

            const velocity = new THREE.Vector3(
                rng() > 0.5 ? 1 : -1,
                0,
                rng() > 0.5 ? 1 : -1
            );

            let label = null;
            if (name) {
                label = makeLabel(name);
                mesh.add(label);
            }

            scene.add(mesh);
            entities.push({ mesh, velocity, type, health: 3, id: name, label });
        }

        async function startGame(seedWord) {
            entities.forEach(e => scene.remove(e.mesh));
            entities.length = 0;

            const room = location.pathname.split('/').pop();
            const baseSeed = await shaSeed(room + ':' + seedWord);

            const names = [...document.querySelectorAll('#userlist .userlist_item span:nth-child(2)')]
                .map(n => n.textContent.trim())
                .filter(Boolean)
                .sort();

            names.forEach((name, i) => {
                const rng = mulberry32(baseSeed + i);
                spawnEntity(tankMat, rng, 'tank', name);
            });

            for (let i = 0; i < 6; i++) spawnEntity(foeMat, mulberry32(baseSeed + 1000 + i), 'foe');
            for (let i = 0; i < 8; i++) spawnEntity(foodMat, mulberry32(baseSeed + 2000 + i), 'food');
        }

        /* ------------------ Animation ------------------ */
        function animate() {
            requestAnimationFrame(animate);
            tickCounter++;

            if (tickCounter % MOVE_EVERY_N_TICKS === 0) {
                for (const e of entities) {
                    e.mesh.position.add(e.velocity);

                    if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                    if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
                }

                // Pairwise collisions
                for (let i = 0; i < entities.length; i++) {
                    for (let j = i + 1; j < entities.length; j++) {
                        const A = entities[i], B = entities[j];
                        if (A.type === 'ghost' || B.type === 'ghost') continue;

                        const boxA = new THREE.Box3().setFromObject(A.mesh);
                        const boxB = new THREE.Box3().setFromObject(B.mesh);
                        if (!boxA.intersectsBox(boxB)) continue;

                        // Swap velocities
                        const tmp = A.velocity.clone();
                        A.velocity.copy(B.velocity);
                        B.velocity.copy(tmp);

                        // Health adjustments
                        if (A.type === 'tank' && B.type === 'foe') { A.health -= 2; scene.remove(B.mesh); entities.splice(j,1); j--; continue; }
                        if (A.type === 'foe' && B.type === 'tank') { B.health -= 2; scene.remove(A.mesh); entities.splice(i,1); i--; break; }
                        if (A.type === 'tank' && B.type === 'food') { A.health += 1; scene.remove(B.mesh); entities.splice(j,1); j--; continue; }
                        if (A.type === 'food' && B.type === 'tank') { B.health += 1; scene.remove(A.mesh); entities.splice(i,1); i--; break; }
                        if (A.type === 'tank' && B.type === 'tank') { A.health -= 1; B.health -= 1; }
                    }
                }

                // Ghost conversion
                for (let e of entities) {
                    if (e.type === 'tank' && e.health <= 0) {
                        e.type = 'ghost';
                        e.mesh.material = ghostMat;
                        e.health = 0;
                    }
                }
            }

            renderer.render(scene, camera);
        }

        animate();

        /* ------------------ Chat commands ------------------ */
        function handleChatMsg(user, msg) {
            if (!msg) return;
            const text = msg.trim().toLowerCase();

            // Ghost movement
            const ghost = entities.find(e => e.type === 'ghost' && e.id?.trim().toLowerCase() === user?.trim().toLowerCase());
            if (!ghost) return;

            const speed = 1;
            if (text.includes('t')) ghost.velocity.z = -speed;
            if (text.includes('f')) ghost.velocity.z = speed;
            if (text.includes('g')) ghost.velocity.x = -speed;
            if (text.includes('v')) ghost.velocity.x = speed;
        }

        if (window.socket && typeof window.socket.on === 'function') {
            const tryEvents = ['chatMsg', 'chat message', 'chat message new', 'chat'];
            tryEvents.forEach(ev => {
                window.socket.on(ev, data => {
                    try {
                        const user = data.user || data.username;
                        const msg = data.msg || data.message || data;
                        if (!msg) return;
                        handleChatMsg(user, msg);

                        const m = msg.match(/^\/startgame\s+(.+)/i);
                        if (m) startGame(m[1]);
                    } catch(e){}
                });
            });
        }

        console.log('[BattleTanks] Ghost chat movement enabled, collisions intact.');
    }

    main();
})();
