# Plugin Alpha ESS — A.V.A.T.A.R

Monitoring en temps réel de votre installation solaire et batterie **Alpha ESS** via l'API officielle [open.alphaess.com](https://open.alphaess.com).

---

## Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| ⚡ **Données temps réel** | Production PV, consommation maison, échange réseau, puissance batterie, SOC |
| 📊 **Bilan journalier** | Énergie produite, consommée, importée, exportée en kWh |
| 📈 **Courbe multi-courbes** | PV (jaune), Maison (bleu), Import EDF (marron), Export réseau (rouge), SOC % (vert) |
| 💶 **Économies** | Calcul des économies journalières en € |
| 🌿 **CO₂ évité** | Calcul du CO₂ et carbone évités en kg |
| 📅 **Historique 7 jours** | Barres de production des 7 derniers jours |
| 🔔 **Alertes vocales** | Batterie faible (≤ 15%), batterie pleine (100%), pas de production en journée |
| 📱 **Notifications push** | Via ntfy — envoyées quand la batterie est faible ou en panne |
| 🌐 **Dashboard web** | Interface accessible depuis n'importe quel appareil du réseau local |
| 🎛️ **Widget Avatar** | Bouton d'accès rapide dans l'interface Avatar |

---

# Dashboard web

Accessible depuis n'importe quel appareil sur le réseau local (mobile egalement) :
```
http://192.168.1.9:3847
```

---

## Courbe de production

La courbe est construite **localement** à chaque cycle cron (toutes les 30s) et sauvegardée dans `assets/curve.json`. Elle survit aux redémarrages d'Avatar et se remet à zéro automatiquement chaque jour.

| Courbe | Couleur | Description |
|---|---|---|
| ☀️ PV | Jaune | Production solaire instantanée |
| 🏠 Maison | Bleu | Consommation maison |
| 📥 Import | Marron tirets | Import depuis le réseau EDF |
| 📤 Export | Rouge tirets | Export vers le réseau EDF |
| 🔋 SOC | Vert (axe droit) | Niveau de charge batterie en % |

---

## Alertes vocales

| Alerte | Déclenchement | Message |
|---|---|---|
| 🔋 Batterie faible | SOC ≤ 15% | *"Attention ! La batterie est faible : X pourcent."* |
| 🔋 Batterie pleine | SOC = 100% | *"Attention ! La batterie est chargée à cent pourcent."* |
| ☀️ Pas de production | < 10W entre 7h-19h | *"Attention ! Aucune production solaire détectée."* |

Les alertes commencent par **"Attention !"** → déclenchement automatique ntfy si le plugin est installé.

---

## Commandes vocales

- *"Sarah, quelle est la production solaire ?"*
- *"Sarah, quel est le niveau de la batterie ?"*
- *"Sarah, quelle est la puissance actuelle ?"*
- *"Sarah, combien a-t-on importé du réseau aujourd'hui ?"*
- *"Sarah, quel est le taux d'autosuffisance ?"*
- *"Sarah, combien a-t-on économisé aujourd'hui ?"*
- *"Sarah, combien de CO2 avons-nous évité ?"*
- *"Sarah, quel était le pic de production aujourd'hui ?"*
- *"Sarah, donne-moi le statut complet du système."*

---

Exemple 
<img width="348" height="846" alt="image" src="https://github.com/user-attachments/assets/bc7f246a-c64d-43c0-a57e-8f462b033c87" />
