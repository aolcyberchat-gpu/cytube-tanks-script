// ==UserScript==
// @name         CyTube BattleTanks — Deterministic Grid Movement
// @namespace    http://www.cytu.be
// @version      1.1.0
// @description  Deterministic tanks/foes/food using /startgame <seed>, integer grid movement, collisions, ghosts
// @author       Guy McFurry III
// @match        https://cytu.be/r/BLOGUS
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function loadThree(version = '0.158.0') {
        return new Promise((resolve, reject) => {
            if (window.THREE) return resolve(window.THREE);
            const s = document.createElement('script');
            s.src = `https://cdn.jsdelivr.net/npm/three@${version}/build/three.min.js`;
            s.onload = () => resolve(window.THREE);
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function sha256Hex(str) {
        const enc = new TextEncoder();
        const data = enc.encode(str);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function hexToSeedInt(hex) {
        return parseInt(hex.slice(0, 8), 16) >>> 0;
    }

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    async function main() {
        await loadThree();

        /* =======================
           GRID / WORLD CONSTANTS
        ======================= */
        const CELL_SIZE = 1.5;
        const GRID_LIMIT = 32;

        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.zIndex = '-1';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(0, 20, 40);
        camera.lookAt(0, 0, 0);

        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        });

        /* =======================
           TERRAIN
        ======================= */
        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const loader = new THREE.TextureLoader();
        const terrainTex = loader.load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif');
        const terrainMat = new THREE.MeshBasicMaterial({ map: terrainTex });
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

        /* =======================
           TEXTURES / MATERIALS
        ======================= */
        const userTex = loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp');
        const foeTex = loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp');
        const foodTex = loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp');
        const ghostTex = loader.load('https://i.ibb.co/CKMC9K3v/ghost-user.gif');

        const userMatGreen = new THREE.MeshBasicMaterial({ map: userTex, color: 0x00ff00 });
        const userMatYellow = new THREE.MeshBasicMaterial({ map: userTex, color: 0xffff00 });
        const userMatRed = new THREE.MeshBasicMaterial({ map: userTex, color: 0xff0000 });
        const foeMat = new THREE.MeshBasicMaterial({ map: foeTex });
        const foodMat = new THREE.MeshBasicMaterial({ map: foodTex });
        const ghostMat = new THREE.MeshBasicMaterial({ map: ghostTex });

        const entityGeo = new THREE.BoxGeometry(2, 3, 2);

        const entities = [];
        const knownUsers = new Map();

        function clearEntities() {
            while (entities.length) {
                const e = entities.pop();
                scene.remove(e.mesh);
            }
            knownUsers.clear();
        }

        function roomNameFromPath() {
            const parts = window.location.pathname.split('/');
            return parts[parts.length - 1] || 'room';
        }

        function getSanitizedUsernames() {
            const out = [];
            document.querySelectorAll('#userlist .userlist_item span:nth-of-type(2)')
                .forEach(s => s.textContent && out.push(s.textContent.trim()));
            return Array.from(new Set(out)).sort();
        }

        function createTextLabel(text) {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            ctx.font = 'bold 20px Arial';
            c.width = ctx.measureText(text).width + 10;
            c.height = 30;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = 'white';
            ctx.fillText(text, 5, 20);
            const tex = new THREE.Texture(c);
            tex.needsUpdate = true;
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            spr.scale.set(c.width / 10, c.height / 10, 1);
            return spr;
        }

        async function spawnDeterministic(seedWord) {
            clearEntities();

            const room = roomNameFromPath();
            const globalSeedHex = await sha256Hex(`${room}:${seedWord}`);
            const users = getSanitizedUsernames();

            /* USERS */
            for (const uname of users) {
                const h = await sha256Hex(globalSeedHex + uname);
                const pr = mulberry32(hexToSeedInt(h));

                const gx = Math.round((pr() - 0.5) * GRID_LIMIT);
                const gz = Math.round((pr() - 0.5) * GRID_LIMIT);
                const dirX = pr() > 0.5 ? 1 : -1;
                const dirZ = pr() > 0.5 ? 1 : -1;

                const mesh = new THREE.Mesh(entityGeo, userMatGreen);
                mesh.position.set(gx * CELL_SIZE, 1, gz * CELL_SIZE);

                const label = createTextLabel(uname);
                label.position.set(0, 4, 0);
                mesh.add(label);

                const ent = {
                    mesh,
                    type: 'user',
                    id: uname,
                    gridX: gx,
                    gridZ: gz,
                    dirX,
                    dirZ,
                    health: 3
                };

                entities.push(ent);
                knownUsers.set(uname, ent);
                scene.add(mesh);
            }

            /* FOES + FOOD */
            function spawnSet(type, count, mat) {
                for (let i = 0; i < count; i++) {
                    const h = mulberry32(hexToSeedInt(globalSeedHex + type + i));
                    const gx = Math.round((h() - 0.5) * GRID_LIMIT);
                    const gz = Math.round((h() - 0.5) * GRID_LIMIT);
                    const dirX = h() > 0.5 ? 1 : -1;
                    const dirZ = h() > 0.5 ? 1 : -1;

                    const mesh = new THREE.Mesh(entityGeo, mat);
                    mesh.position.set(gx * CELL_SIZE, 1, gz * CELL_SIZE);

                    entities.push({ mesh, type, gridX: gx, gridZ: gz, dirX, dirZ });
                    scene.add(mesh);
                }
            }

            spawnSet('foe', Math.max(4, users.length), foeMat);
            spawnSet('food', Math.max(4, Math.floor(users.length * 0.8)), foodMat);
        }

        function animate() {
            requestAnimationFrame(animate);

            for (const e of entities) {

                if (e.type !== 'ghost') {
                    e.gridX += e.dirX;
                    e.gridZ += e.dirZ;
                }

                if (e.gridX >= GRID_LIMIT || e.gridX <= -GRID_LIMIT) {
                    e.dirX *= -1;
                    e.gridX += e.dirX;
                }

                if (e.gridZ >= GRID_LIMIT || e.gridZ <= -GRID_LIMIT) {
                    e.dirZ *= -1;
                    e.gridZ += e.dirZ;
                }

                e.mesh.position.x = e.gridX * CELL_SIZE;
                e.mesh.position.z = e.gridZ * CELL_SIZE;

                if (e.type === 'user') {
                    e.mesh.material =
                        e.health >= 3 ? userMatGreen :
                        e.health === 2 ? userMatYellow :
                        userMatRed;
                }
            }

            /* COLLISIONS */
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const A = entities[i], B = entities[j];
                    if (A.type === 'ghost' || B.type === 'ghost') continue;

                    const boxA = new THREE.Box3().setFromObject(A.mesh);
                    const boxB = new THREE.Box3().setFromObject(B.mesh);
                    if (!boxA.intersectsBox(boxB)) continue;

                    [A.dirX, B.dirX] = [B.dirX, A.dirX];
                    [A.dirZ, B.dirZ] = [B.dirZ, A.dirZ];

                    if (A.type === 'user' && B.type === 'foe') A.health -= 2;
                    if (B.type === 'user' && A.type === 'foe') B.health -= 2;
                    if (A.type === 'user' && B.type === 'food') A.health += 1;
                    if (B.type === 'user' && A.type === 'food') B.health += 1;
                    if (A.type === 'user' && B.type === 'user') { A.health--; B.health--; }
                }
            }

            for (const e of entities) {
                if (e.type === 'user' && e.health <= 0) {
                    e.type = 'ghost';
                    e.mesh.material = ghostMat;
                }
            }

            renderer.render(scene, camera);
        }

        animate();

        const startRegex = /^\/startgame\s+(.+)$/i;
        function handleChat(msg) {
            const m = msg.match(startRegex);
            if (m) spawnDeterministic(m[1].trim());
        }

        if (window.socket) {
            window.socket.on('chatMsg', d => d.msg && handleChat(d.msg));
        }
    }

    main();
})();
