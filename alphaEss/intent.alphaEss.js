import {default as _helpers} from '../../ia/node_modules/ava-ia/helpers/index.js';

export default async function (state, actions) {
    if (state.isIntent) return (0, _helpers.resolve)(state);

    for (var rule in Config.modules.alphaEss.rules) {
        var match = (0, _helpers.syntax)(state.sentence, Config.modules.alphaEss.rules[rule]);
        if (match) break;
    }

    if (match) {
        state.isIntent = true;
        state.rule = rule;
        return (0, _helpers.factoryActions)(state, actions);
    } else {
        return (0, _helpers.resolve)(state);
    }
};
