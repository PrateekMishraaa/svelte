/** @import { Derived } from '#client' */
import { DEV } from 'esm-env';
import { CLEAN, DERIVED, DESTROYED, DIRTY, MAYBE_DIRTY, UNOWNED } from '../constants.js';
import {
	current_reaction,
	current_effect,
	remove_reactions,
	set_signal_status,
	current_skip_reaction,
	update_reaction,
	destroy_effect_children,
	increment_version,
	get
} from '../runtime.js';
import { equals, safe_equals } from './equality.js';
import * as e from '../errors.js';
import { set, source } from './sources.js';

/**
 * @template V
 * @param {() => V} fn
 * @returns {Derived<V>}
 */
/*#__NO_SIDE_EFFECTS__*/
export function derived(fn) {
	let flags = DERIVED | DIRTY;
	if (current_effect === null) flags |= UNOWNED;

	/** @type {Derived<V>} */
	const signal = {
		deps: null,
		deriveds: null,
		equals,
		f: flags,
		first: null,
		fn,
		last: null,
		reactions: null,
		v: /** @type {V} */ (null),
		version: 0
	};

	if (current_reaction !== null && (current_reaction.f & DERIVED) !== 0) {
		var current_derived = /** @type {Derived} */ (current_reaction);
		if (current_derived.deriveds === null) {
			current_derived.deriveds = [signal];
		} else {
			current_derived.deriveds.push(signal);
		}
	}

	return signal;
}

/**
 * @template V
 * @param {() => V} get_value
 * @returns {(value?: V) => V}
 */
export function derived_source(get_value) {
	var was_local = false;
	var local_source = source(/** @type {V} */ (undefined));

	var linked_derived = derived(() => {
		var local_value = /** @type {V} */ (get(local_source));
		var linked_value = get_value();

		if (was_local) {
			was_local = false;
			return local_value;
		}

		return linked_value;
	});

	return function (/** @type {any} */ value) {
		if (arguments.length > 0) {
			was_local = true;
			set(local_source, value);
			get(linked_derived);
			return value;
		}

		return (local_source.v = get(linked_derived));
	};
}

/**
 * @template V
 * @param {() => V} fn
 * @returns {Derived<V>}
 */
/*#__NO_SIDE_EFFECTS__*/
export function derived_safe_equal(fn) {
	const signal = derived(fn);
	signal.equals = safe_equals;
	return signal;
}

/**
 * @param {Derived} derived
 * @returns {void}
 */
function destroy_derived_children(derived) {
	destroy_effect_children(derived);
	var deriveds = derived.deriveds;

	if (deriveds !== null) {
		derived.deriveds = null;

		for (var i = 0; i < deriveds.length; i += 1) {
			destroy_derived(deriveds[i]);
		}
	}
}

/**
 * The currently updating deriveds, used to detect infinite recursion
 * in dev mode and provide a nicer error than 'too much recursion'
 * @type {Derived[]}
 */
let stack = [];

/**
 * @param {Derived} derived
 * @returns {void}
 */
export function update_derived(derived) {
	var value;

	if (DEV) {
		try {
			if (stack.includes(derived)) {
				e.derived_references_self();
			}

			stack.push(derived);

			destroy_derived_children(derived);
			value = update_reaction(derived);
		} finally {
			stack.pop();
		}
	} else {
		destroy_derived_children(derived);
		value = update_reaction(derived);
	}

	var status =
		(current_skip_reaction || (derived.f & UNOWNED) !== 0) && derived.deps !== null
			? MAYBE_DIRTY
			: CLEAN;

	set_signal_status(derived, status);

	if (!derived.equals(value)) {
		derived.v = value;
		derived.version = increment_version();
	}
}

/**
 * @param {Derived} signal
 * @returns {void}
 */
function destroy_derived(signal) {
	destroy_derived_children(signal);
	remove_reactions(signal, 0);
	set_signal_status(signal, DESTROYED);

	// TODO we need to ensure we remove the derived from any parent derives

	signal.first =
		signal.last =
		signal.deps =
		signal.reactions =
		// @ts-expect-error `signal.fn` cannot be `null` while the signal is alive
		signal.fn =
			null;
}
